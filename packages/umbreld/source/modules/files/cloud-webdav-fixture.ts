import {createHash} from 'node:crypto'
import fsp from 'node:fs/promises'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import https from 'node:https'
import nodePath from 'node:path'

import {execa} from 'execa'

type Failure = {method?: string; path?: string; status: number; remaining: number}
type ReadBehavior = {chunkSize: number; delayMs: number; stallAfterBytes?: number}

export type WebDavRequest = {method: string; path: string}

const xmlEscape = (value: string) =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const hrefPath = (path: string, directory: boolean) => {
	const encoded = path
		.split('/')
		.map((component) => encodeURIComponent(component))
		.join('/')
	return directory && !encoded.endsWith('/') ? `${encoded}/` : encoded
}

const boundedPath = (root: string, requestPath: string) => {
	const relative = requestPath
		.split('/')
		.filter(Boolean)
		.map((component) => decodeURIComponent(component))
	if (relative.some((component) => component === '.' || component === '..' || component.includes('\0'))) {
		throw new Error('invalid path')
	}
	const path = nodePath.join(root, ...relative)
	if (path !== root && !path.startsWith(`${root}${nodePath.sep}`)) throw new Error('invalid path')
	return path
}

const statusText = (status: number) => http.STATUS_CODES[status] ?? 'Error'

export default class CloudWebDavFixture {
	readonly root: string
	readonly requests: WebDavRequest[] = []
	readonly mutatingRequests: WebDavRequest[] = []
	onMutatingRequest?: (request: WebDavRequest) => void

	private server?: Server
	private username = 'cloud-user'
	private password = 'cloud-password'
	private failures: Failure[] = []
	private readBehaviors = new Map<string, ReadBehavior>()
	private responses = new Set<ServerResponse>()

	constructor(root: string) {
		this.root = root
	}

	async start({tls = false, port = 0}: {tls?: boolean; port?: number} = {}) {
		await fsp.mkdir(this.root, {recursive: true})
		if (tls) {
			const key = nodePath.join(this.root, '.fixture-key.pem')
			const cert = nodePath.join(this.root, '.fixture-cert.pem')
			await execa(
				'openssl',
				[
					'req',
					'-x509',
					'-newkey',
					'rsa:2048',
					'-nodes',
					'-keyout',
					key,
					'-out',
					cert,
					'-days',
					'1',
					'-subj',
					'/CN=127.0.0.1',
					'-addext',
					'subjectAltName=IP:127.0.0.1',
				],
				{env: {OPENSSL_CONF: '/etc/ssl/openssl.cnf'}},
			)
			this.server = https.createServer(
				{key: await fsp.readFile(key), cert: await fsp.readFile(cert)},
				(request, response) => this.handle(request, response),
			)
		} else {
			this.server = http.createServer((request, response) => this.handle(request, response))
		}
		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject)
			this.server!.listen(port, '127.0.0.1', () => resolve())
		})
		const address = this.server.address()
		if (!address || typeof address === 'string') throw new Error('fixture failed to bind')
		return `${tls ? 'https' : 'http'}://127.0.0.1:${address.port}/`
	}

	async close() {
		for (const response of this.responses) response.destroy()
		if (!this.server) return
		await new Promise<void>((resolve) => this.server!.close(() => resolve()))
		this.server = undefined
	}

	setCredentials(username: string, password: string) {
		this.username = username
		this.password = password
	}

	failNext({method, path, status, times = 1}: {method?: string; path?: string; status: number; times?: number}) {
		this.failures.push({method, path, status, remaining: times})
	}

	clearFailures() {
		this.failures = []
	}

	setReadBehavior(path: string, behavior?: Partial<ReadBehavior>) {
		if (!behavior) {
			this.readBehaviors.delete(path)
			return
		}
		this.readBehaviors.set(path, {
			chunkSize: behavior.chunkSize ?? 64 * 1024,
			delayMs: behavior.delayMs ?? 25,
			...(behavior.stallAfterBytes === undefined ? {} : {stallAfterBytes: behavior.stallAfterBytes}),
		})
	}

	clearRequests() {
		this.requests.length = 0
		this.mutatingRequests.length = 0
	}

	async write(path: string, contents: string | Buffer) {
		const target = boundedPath(this.root, path)
		await fsp.mkdir(nodePath.dirname(target), {recursive: true})
		await fsp.writeFile(target, contents)
	}

	async mkdir(path: string) {
		await fsp.mkdir(boundedPath(this.root, path), {recursive: true})
	}

	async remove(path: string) {
		await fsp.rm(boundedPath(this.root, path), {recursive: true, force: true})
	}

	async fingerprint() {
		const hash = createHash('sha256')
		const visit = async (directory: string, relative = ''): Promise<void> => {
			const entries = await fsp.readdir(directory, {withFileTypes: true})
			entries.sort((left, right) => left.name.localeCompare(right.name))
			for (const entry of entries) {
				if (entry.name.startsWith('.fixture-')) continue
				const path = nodePath.join(directory, entry.name)
				const name = relative ? `${relative}/${entry.name}` : entry.name
				hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${name}\0`)
				if (entry.isDirectory()) await visit(path, name)
				else hash.update(await fsp.readFile(path))
			}
		}
		await visit(this.root)
		return hash.digest('hex')
	}

	private async handle(request: IncomingMessage, response: ServerResponse) {
		this.responses.add(response)
		response.once('close', () => this.responses.delete(response))
		request.resume()
		const method = request.method ?? 'GET'
		let path: string
		try {
			path = new URL(request.url ?? '/', 'http://fixture').pathname
			boundedPath(this.root, path)
		} catch {
			return this.respond(response, 400)
		}
		const record = {method, path}
		this.requests.push(record)
		if (!['OPTIONS', 'PROPFIND', 'GET', 'HEAD'].includes(method)) {
			this.mutatingRequests.push(record)
			this.onMutatingRequest?.(record)
		}

		const expectedAuthorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
		if (request.headers.authorization !== expectedAuthorization) {
			response.setHeader('WWW-Authenticate', 'Basic realm="cloud-test"')
			return this.respond(response, 401)
		}

		const failure = this.failures.find(
			(candidate) =>
				candidate.remaining > 0 &&
				(candidate.method === undefined || candidate.method === method) &&
				(candidate.path === undefined || candidate.path === path),
		)
		if (failure) {
			failure.remaining -= 1
			if (failure.status === 401) response.setHeader('WWW-Authenticate', 'Basic realm="cloud-test"')
			return this.respond(response, failure.status)
		}

		if (method === 'OPTIONS') {
			response.setHeader('Allow', 'OPTIONS, PROPFIND, GET, HEAD')
			response.setHeader('DAV', '1, 2')
			return this.respond(response, 200)
		}

		const systemPath = boundedPath(this.root, path)
		let stats
		try {
			stats = await fsp.lstat(systemPath)
			if (!stats.isDirectory() && !stats.isFile()) return this.respond(response, 404)
		} catch {
			return this.respond(response, 404)
		}

		if (method === 'PROPFIND') return this.propfind(request, response, path, systemPath, stats)
		if (stats.isDirectory()) return this.respond(response, 405)
		response.setHeader('Content-Type', 'application/octet-stream')
		response.setHeader('Content-Length', stats.size)
		response.setHeader('Last-Modified', stats.mtime.toUTCString())
		if (method === 'HEAD') return response.end()
		return this.sendFile(response, path, systemPath)
	}

	private async propfind(
		request: IncomingMessage,
		response: ServerResponse,
		requestPath: string,
		systemPath: string,
		stats: Awaited<ReturnType<typeof fsp.lstat>>,
	) {
		const entries: {path: string; stats: typeof stats}[] = [{path: requestPath, stats}]
		if (stats.isDirectory() && request.headers.depth !== '0') {
			for (const entry of await fsp.readdir(systemPath, {withFileTypes: true})) {
				if (entry.name.startsWith('.fixture-')) continue
				const childPath = nodePath.posix.join(requestPath, entry.name)
				entries.push({path: childPath, stats: await fsp.lstat(nodePath.join(systemPath, entry.name))})
			}
		}
		const body = `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">${entries
			.map(({path, stats}) => {
				const directory = stats.isDirectory()
				const etag = `&quot;${Number(stats.size).toString(16)}-${Math.floor(Number(stats.mtimeMs)).toString(16)}&quot;`
				return `<d:response><d:href>${xmlEscape(hrefPath(path, directory))}</d:href><d:propstat><d:prop><d:displayname>${xmlEscape(
					nodePath.posix.basename(path) || '/',
				)}</d:displayname><d:resourcetype>${directory ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>${
					stats.size
				}</d:getcontentlength><d:getlastmodified>${stats.mtime.toUTCString()}</d:getlastmodified><d:getetag>${etag}</d:getetag><d:getcontenttype>${
					directory ? 'httpd/unix-directory' : 'application/octet-stream'
				}</d:getcontenttype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
			})
			.join('')}</d:multistatus>`
		response.writeHead(207, {
			'Content-Type': 'application/xml; charset=utf-8',
			'Content-Length': Buffer.byteLength(body),
		})
		response.end(body)
	}

	private async sendFile(response: ServerResponse, requestPath: string, systemPath: string) {
		const contents = await fsp.readFile(systemPath)
		if (!this.readBehaviors.has(requestPath)) return response.end(contents)
		let offset = 0
		const send = () => {
			if (response.destroyed) return
			// Re-read the behavior so clearing it can release an in-flight stalled response.
			const behavior = this.readBehaviors.get(requestPath)
			if (!behavior) return response.end(contents.subarray(offset))
			if (behavior.stallAfterBytes !== undefined && offset >= behavior.stallAfterBytes) {
				return setTimeout(send, behavior.delayMs).unref()
			}
			if (offset >= contents.length) return response.end()
			const end = Math.min(contents.length, offset + behavior.chunkSize)
			response.write(contents.subarray(offset, end))
			offset = end
			setTimeout(send, behavior.delayMs).unref()
		}
		send()
	}

	private respond(response: ServerResponse, status: number) {
		response.statusCode = status
		response.end(statusText(status))
	}
}
