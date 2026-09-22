import {execFile} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest'

import AppGateway from '../app-gateway/app-gateway.js'
import {APP_GATEWAY_HTTP_COOKIE_NAME, APP_GATEWAY_HTTPS_COOKIE_NAME} from '../auth/app-gateway-cookie.js'
import LanIngress from './lan-ingress.js'

type ProxyFactory = {
	createHttpProxyServer(port: number, protocol: 'http'): http.Server
	createHttpsProxyServer(port: number): Promise<https.Server>
}

const logger = {createChildLogger: () => logger, verbose: () => {}, log: () => {}, error: () => {}}
const servers: http.Server[] = []
const sockets = new Set<net.Socket>()
const chunk = Buffer.alloc(1024, 'upload')
const chunkCount = 20
const routes = [
	{protocol: 'http', gateway: false},
	{protocol: 'https', gateway: false},
	{protocol: 'http', gateway: true},
	{protocol: 'https', gateway: true},
] as const
let directory: string
let ingress: ProxyFactory

beforeAll(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-upload-'))
	const instance = new LanIngress({dataDirectory: directory, logger} as never)
	await fs.mkdir(instance.directory)
	await promisify(execFile)('openssl', [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-days',
		'1',
		'-keyout',
		instance.serverKeyPath,
		'-out',
		instance.serverCertificatePath,
		'-subj',
		'/CN=localhost',
	])
	ingress = instance as unknown as ProxyFactory
})

afterEach(async () => {
	vi.restoreAllMocks()
	for (const socket of sockets) socket.destroy()
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

afterAll(async () => fs.rm(directory, {recursive: true, force: true}))

async function listen(server: http.Server) {
	servers.push(server)
	server.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
		socket.once('close', () => sockets.delete(socket))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	return (server.address() as net.AddressInfo).port
}

async function createProxy(protocol: 'http' | 'https', upstreamPort: number, gateway = false) {
	// Exercise the real Node deadline without a five-minute test. Only shorten
	// the constructor defaults; the production factory must disable the deadline.
	// Scale the header timeout too: Node swaps the deadlines if it is larger.
	const createHttpServer = http.createServer
	const createHttpsServer = https.createServer
	const shortenDeadline = <T extends http.Server>(server: T) =>
		Object.assign(server, {requestTimeout: 1000, headersTimeout: 500, connectionsCheckingInterval: 50})
	const httpSpy = vi
		.spyOn(http, 'createServer')
		.mockImplementation((...args) => shortenDeadline(createHttpServer(...args)))
	const httpsSpy = vi
		.spyOn(https, 'createServer')
		.mockImplementation((...args) => shortenDeadline(createHttpsServer(...args)))
	try {
		if (gateway) {
			const auth = {
				authenticate: async (token: string) => {
					if (token !== 'upload-session') throw new Error('Unauthorized')
					return {accountId: 'owner'}
				},
				authorizeApp: async () => {},
			}
			const server = new AppGateway({logger, auth} as never, {
				appId: 'upload-test',
				appName: 'Upload test',
				appIcon: '',
				targetProtocol: 'http',
				targetHost: '127.0.0.1',
				targetPort: upstreamPort,
				auth: true,
				authWhitelist: [],
				authBlacklist: [],
				trustUpstream: false,
				timeout: 0,
			}).server
			expect(server.headersTimeout).toBe(500)
			// HTTP goes straight to the gateway; HTTPS terminates at LAN ingress first.
			if (protocol === 'http') return server
			upstreamPort = await listen(server)
		}
		return protocol === 'http'
			? ingress.createHttpProxyServer(upstreamPort, 'http')
			: await ingress.createHttpsProxyServer(upstreamPort)
	} finally {
		httpSpy.mockRestore()
		httpsSpy.mockRestore()
	}
}

function upload(protocol: 'http' | 'https', port: number) {
	return new Promise<{status: number | undefined; body: Buffer}>((resolve, reject) => {
		const client = protocol === 'http' ? http : https
		const request = client.request(
			{
				hostname: '127.0.0.1',
				port,
				method: 'POST',
				agent: false,
				rejectUnauthorized: false,
				headers: {
					'content-length': chunk.length * chunkCount,
					cookie: `${protocol === 'https' ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME}=upload-session`,
				},
			},
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (data: Buffer) => chunks.push(data))
				response.on('error', reject)
				response.on('end', () => {
					request.destroy()
					resolve({status: response.statusCode, body: Buffer.concat(chunks)})
				})
			},
		)
		request.on('error', reject)
		request.flushHeaders()
		let sent = 0
		// Keep sending data throughout the upload, so this is a total request
		// deadline regression rather than an idle socket timeout.
		const timer = setInterval(() => {
			request.write(chunk)
			if (++sent === chunkCount) {
				clearInterval(timer)
				request.end()
			}
		}, 100)
		request.once('close', () => clearInterval(timer))
	})
}

test.each(routes)(
	'$protocol proxies an active upload beyond the request deadline (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		const upstream = http.createServer((request, response) => {
			const chunks: Buffer[] = []
			request.on('data', (data: Buffer) => chunks.push(data))
			request.on('error', () => {})
			request.on('end', () => response.end(Buffer.concat(chunks)))
		})
		upstream.requestTimeout = 0
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		expect(proxy.headersTimeout).toBe(500)
		const response = await upload(protocol, await listen(proxy))
		expect(response.status).toBe(200)
		expect(response.body).toEqual(Buffer.concat(Array.from({length: chunkCount}, () => chunk)))
	},
)

test.each(routes)(
	'$protocol preserves an upstream upload deadline (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		let upstreamErrorCode: string | undefined
		const upstream = http.createServer({connectionsCheckingInterval: 50}, (request, response) => {
			request.on('error', () => {})
			request.resume()
			request.on('end', () => response.end('completed'))
		})
		upstream.requestTimeout = 500
		upstream.headersTimeout = 250
		upstream.on('clientError', (error, socket) => {
			upstreamErrorCode = (error as NodeJS.ErrnoException).code
			socket.destroy()
		})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const response = upload(protocol, await listen(proxy))
		if (gateway) {
			// The app gateway translates upstream connection failures into its error page.
			expect((await response).status).toBe(502)
		} else {
			await expect(response).rejects.toMatchObject({code: 'ECONNRESET'})
		}
		expect(upstreamErrorCode).toBe('ERR_HTTP_REQUEST_TIMEOUT')
	},
)
