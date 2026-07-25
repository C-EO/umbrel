export function resolveRedirectUrl(target: string, origin: string) {
	const fallback = new URL('/', origin)

	try {
		const candidate = new URL(target, fallback)
		if (!target.startsWith('/') || candidate.origin !== fallback.origin || candidate.pathname.startsWith('/login')) {
			return fallback
		}
		return candidate
	} catch {
		return fallback
	}
}
