import assert from 'node:assert/strict'
import test from 'node:test'

import {createAuthenticatedTerminalSocket, type TerminalSocket} from './terminal-connection.ts'

class FakeSocket implements TerminalSocket {
	#listeners = new Map<string, Array<() => void>>()

	addEventListener(type: 'open' | 'error' | 'close', listener: () => void) {
		this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
	}

	emit(type: 'open' | 'error' | 'close') {
		for (const listener of this.#listeners.get(type) ?? []) listener()
	}
}

test('reports ticket failures without trying to construct a terminal socket', async () => {
	let disconnected = 0
	let constructed = 0
	const socket = await createAuthenticatedTerminalSocket({
		getTicket: async () => {
			throw new Error('Unauthorized')
		},
		createSocket: () => {
			constructed++
			return new FakeSocket()
		},
		isCancelled: () => false,
		onConnected: () => {},
		onDisconnected: () => disconnected++,
	})

	assert.equal(socket, undefined)
	assert.equal(constructed, 0)
	assert.equal(disconnected, 1)
})

test('reports socket open and later disconnect events', async () => {
	let connected = 0
	let disconnected = 0
	let receivedTicket = ''
	const fakeSocket = new FakeSocket()
	const socket = await createAuthenticatedTerminalSocket({
		getTicket: async () => 'single-use-ticket',
		createSocket: (ticket) => {
			receivedTicket = ticket
			return fakeSocket
		},
		isCancelled: () => false,
		onConnected: () => connected++,
		onDisconnected: () => disconnected++,
	})

	assert.equal(socket, fakeSocket)
	assert.equal(receivedTicket, 'single-use-ticket')
	fakeSocket.emit('open')
	assert.equal(connected, 1)
	fakeSocket.emit('close')
	assert.equal(disconnected, 1)
})

test('ignores a ticket that arrives after the terminal was disposed', async () => {
	let cancelled = false
	let resolveTicket: (ticket: string) => void = () => {}
	const ticket = new Promise<string>((resolve) => {
		resolveTicket = resolve
	})
	let constructed = 0
	let disconnected = 0
	const socketPromise = createAuthenticatedTerminalSocket({
		getTicket: () => ticket,
		createSocket: () => {
			constructed++
			return new FakeSocket()
		},
		isCancelled: () => cancelled,
		onConnected: () => {},
		onDisconnected: () => disconnected++,
	})

	cancelled = true
	resolveTicket('too-late')
	assert.equal(await socketPromise, undefined)
	assert.equal(constructed, 0)
	assert.equal(disconnected, 0)
})
