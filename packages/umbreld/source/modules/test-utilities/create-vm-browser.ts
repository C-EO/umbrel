import {existsSync} from 'node:fs'
import net from 'node:net'

import {chromium, type Browser} from 'playwright'

type VmBrowserOptions = {
	forwardPorts: Array<{hostPort: number; guestPort: number}>
}

export default async function createVmBrowser({forwardPorts}: VmBrowserOptions) {
	const tunnel = await createSocksTunnel(forwardPorts)
	let browser: Browser
	try {
		const executablePath = findChromiumExecutable()
		browser = await chromium.launch({
			headless: true,
			executablePath,
			proxy: {server: `socks5://127.0.0.1:${tunnel.port}`},
			// Chromium normally bypasses proxies for loopback addresses. VM browser
			// tests intentionally use 127.0.0.1 as seen from inside the guest.
			args: ['--proxy-bypass-list=<-loopback>'],
		})
	} catch (error) {
		await tunnel.close()
		throw error
	}

	return {
		browser,
		close: async () => {
			try {
				await browser.close()
			} finally {
				await tunnel.close()
			}
		},
	}
}

function findChromiumExecutable() {
	const bundled = chromium.executablePath()
	const candidates = [
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		bundled,
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
	]
	const executable = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
	if (!executable) {
		throw new Error('Chromium is unavailable; run `npx playwright install chromium` before VM browser tests')
	}
	return executable
}

async function createSocksTunnel(forwardPorts: VmBrowserOptions['forwardPorts']) {
	const hostPortsByGuestPort = new Map(forwardPorts.map(({hostPort, guestPort}) => [guestPort, hostPort]))
	const sockets = new Set<net.Socket>()
	const server = net.createServer((socket) => {
		sockets.add(socket)
		socket.once('close', () => sockets.delete(socket))
		void proxySocksConnection(hostPortsByGuestPort, socket).catch(() => socket.destroy())
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject)
			resolve()
		})
	})

	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('SOCKS tunnel did not bind a TCP port')

	return {
		port: address.port,
		close: async () => {
			for (const socket of sockets) socket.destroy()
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		},
	}
}

async function proxySocksConnection(hostPortsByGuestPort: Map<number, number>, socket: net.Socket) {
	const reader = createSocketReader(socket)
	const greeting = await reader.read(2)
	if (greeting[0] !== 0x05) throw new Error('Unsupported SOCKS version')
	const methods = await reader.read(greeting[1])
	if (!methods.includes(0x00)) throw new Error('SOCKS client requires authentication')
	socket.write(Buffer.from([0x05, 0x00]))

	const request = await reader.read(4)
	if (request[0] !== 0x05 || request[1] !== 0x01) throw new Error('Unsupported SOCKS request')
	await readSocksHost(reader, request[3])
	const port = (await reader.read(2)).readUInt16BE(0)
	const pending = reader.release()
	const hostPort = hostPortsByGuestPort.get(port)
	if (!hostPort) throw new Error(`VM guest port ${port} is not forwarded`)

	let upstream: net.Socket
	try {
		upstream = await new Promise<net.Socket>((resolve, reject) => {
			const connection = net.createConnection(hostPort, '127.0.0.1')
			connection.once('connect', () => {
				connection.off('error', reject)
				resolve(connection)
			})
			connection.once('error', reject)
		})
	} catch (error) {
		socket.end(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
		throw error
	}

	socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
	if (pending.length) upstream.write(pending)
	socket.pipe(upstream).pipe(socket)
	socket.resume()
	upstream.once('error', () => socket.destroy())
	socket.once('error', () => upstream.destroy())
}

async function readSocksHost(reader: ReturnType<typeof createSocketReader>, addressType: number) {
	if (addressType === 0x01) return [...(await reader.read(4))].join('.')
	if (addressType === 0x03) {
		const length = (await reader.read(1))[0]
		return (await reader.read(length)).toString('utf8')
	}
	if (addressType === 0x04) {
		const address = await reader.read(16)
		return Array.from({length: 8}, (_, index) => address.readUInt16BE(index * 2).toString(16)).join(':')
	}
	throw new Error('Unsupported SOCKS address type')
}

function createSocketReader(socket: net.Socket) {
	let buffered = Buffer.alloc(0)
	let ended: Error | undefined
	let wake: (() => void) | undefined
	const onData = (chunk: Buffer) => {
		buffered = Buffer.concat([buffered, chunk])
		wake?.()
		wake = undefined
	}
	const onEnd = () => {
		ended = new Error('SOCKS client disconnected during handshake')
		wake?.()
		wake = undefined
	}
	socket.on('data', onData)
	socket.once('end', onEnd)
	socket.once('error', onEnd)

	return {
		read: async (length: number) => {
			while (buffered.length < length) {
				if (ended) throw ended
				await new Promise<void>((resolve) => (wake = resolve))
			}
			const value = buffered.subarray(0, length)
			buffered = buffered.subarray(length)
			return value
		},
		release: () => {
			socket.pause()
			socket.off('data', onData)
			socket.off('end', onEnd)
			socket.off('error', onEnd)
			return buffered
		},
	}
}
