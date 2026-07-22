import type express from 'express'

export const BROWSER_SESSION_HTTPS_COOKIE_NAME = '__Host-UMBREL_BROWSER_SESSION_HTTPS'
export const BROWSER_SESSION_HTTP_COOKIE_NAME = 'UMBREL_BROWSER_SESSION'

export const BROWSER_SESSION_COOKIE_NAMES = [BROWSER_SESSION_HTTPS_COOKIE_NAME, BROWSER_SESSION_HTTP_COOKIE_NAME]

export function browserSessionTokenFromRequest(request: express.Request) {
	return request.cookies?.[request.secure ? BROWSER_SESSION_HTTPS_COOKIE_NAME : BROWSER_SESSION_HTTP_COOKIE_NAME]
}

export function setBrowserSessionCookie(
	response: express.Response,
	request: express.Request,
	token: string,
	expires: Date,
) {
	const secure = request.secure
	response.cookie(secure ? BROWSER_SESSION_HTTPS_COOKIE_NAME : BROWSER_SESSION_HTTP_COOKIE_NAME, token, {
		httpOnly: true,
		expires,
		path: '/',
		sameSite: 'lax',
		secure,
	})
}

export function clearBrowserSessionCookies(response: express.Response) {
	response.clearCookie(BROWSER_SESSION_HTTPS_COOKIE_NAME, {path: '/', secure: true})
	response.clearCookie(BROWSER_SESSION_HTTP_COOKIE_NAME, {path: '/'})
}
