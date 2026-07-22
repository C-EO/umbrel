export type SessionDeviceType = 'desktop' | 'mobile' | 'unknown'

export function sessionDeviceType(userAgent?: string): SessionDeviceType {
	if (!userAgent) return 'unknown'
	if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return 'mobile'
	return 'desktop'
}

export function describeSessionUserAgent(userAgent?: string) {
	if (!userAgent) return undefined

	let browser: string | undefined
	if (/Edg\//.test(userAgent)) browser = 'Microsoft Edge'
	else if (/OPR\//.test(userAgent)) browser = 'Opera'
	else if (/Firefox\//.test(userAgent)) browser = 'Firefox'
	else if (/CriOS\//.test(userAgent)) browser = 'Chrome'
	else if (/FxiOS\//.test(userAgent)) browser = 'Firefox'
	else if (/Chrome\//.test(userAgent)) browser = 'Chrome'
	else if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) browser = 'Safari'

	let platform: string | undefined
	if (/iPhone|iPad|iPod/.test(userAgent)) platform = 'iOS'
	else if (/Android/.test(userAgent)) platform = 'Android'
	else if (/Windows/.test(userAgent)) platform = 'Windows'
	else if (/Macintosh|Mac OS X/.test(userAgent)) platform = 'macOS'
	else if (/Linux/.test(userAgent)) platform = 'Linux'

	if (browser && platform) return `${browser} on ${platform}`
	if (browser) return browser
	if (platform) return platform

	const product = /^([A-Za-z][A-Za-z0-9 ._-]{0,39})\//.exec(userAgent)?.[1]
	return product || undefined
}
