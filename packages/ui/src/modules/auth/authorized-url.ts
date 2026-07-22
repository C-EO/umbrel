export type AuthorizedUrlState =
	| {status: 'idle'; url: undefined}
	| {status: 'loading'; url: undefined}
	| {status: 'error'; url: undefined}
	| {status: 'ready'; url: string}

export function withHttpApiToken(url: string, token: string) {
	return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

export function authorizedUrlState(
	url: string | undefined,
	token: string | undefined,
	failed: boolean,
): AuthorizedUrlState {
	if (!url) return {status: 'idle', url: undefined}
	// Preserve a successfully minted URL if a later background refresh fails.
	if (token) return {status: 'ready', url: withHttpApiToken(url, token)}
	if (failed) return {status: 'error', url: undefined}
	return {status: 'loading', url: undefined}
}
