export type TerminalSocket = {
	addEventListener(type: 'open' | 'error' | 'close', listener: () => void): void
}

export async function createAuthenticatedTerminalSocket<T extends TerminalSocket>({
	getTicket,
	createSocket,
	isCancelled,
	onConnected,
	onDisconnected,
}: {
	getTicket: () => Promise<string>
	createSocket: (ticket: string) => T
	isCancelled: () => boolean
	onConnected: () => void
	onDisconnected: () => void
}): Promise<T | undefined> {
	try {
		const ticket = await getTicket()
		if (isCancelled()) return

		const socket = createSocket(ticket)
		socket.addEventListener('open', () => {
			if (!isCancelled()) onConnected()
		})
		const handleDisconnect = () => {
			if (!isCancelled()) onDisconnected()
		}
		socket.addEventListener('error', handleDisconnect)
		socket.addEventListener('close', handleDisconnect)
		return socket
	} catch {
		if (!isCancelled()) onDisconnected()
	}
}
