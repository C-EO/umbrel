type ResponseEvents = {
	destroyed?: boolean
	writableFinished?: boolean
	once(event: 'finish' | 'close', listener: () => void): unknown
}

// Let the request handler write its acknowledgement before destructive work starts.
// `close` also counts: once the server accepts a power action, it must still run if
// the client disconnects before reading the response.
export function runAfterResponse(response: ResponseEvents | undefined, action: () => void) {
	let started = false
	const start = () => {
		if (started) return
		started = true
		action()
	}

	if (!response) {
		setImmediate(start)
		return
	}

	response.once('finish', start)
	response.once('close', start)
	// Authentication is asynchronous, so the client may have disconnected before
	// the route registers these listeners. Events are not replayed; check the
	// current response state after attaching them to close that race.
	if (response.destroyed || response.writableFinished) start()
}
