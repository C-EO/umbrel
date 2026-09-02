// Backend errors are shaped '[code] prose': a machine-readable kebab-case
// prefix followed by a human-readable message. Match on the code, never the
// prose, and never surface the bracketed code itself to the user.
const backendErrorPattern = /^\[([a-z0-9-]+)\] ?/

export function getErrorCode(message: string) {
	return message.match(backendErrorPattern)?.[1]
}

export function stripErrorCode(message: string) {
	return message.replace(backendErrorPattern, '')
}
