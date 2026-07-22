import {AUTH_TOKEN_LOCAL_STORAGE_KEY, clearAuthToken} from './token-renewal.ts'

type AuthTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function finishLogout(storage: AuthTokenStorage, redirect: (path: string) => void) {
	clearAuthToken(storage)
	redirect('/login')
}

export function finishLogoutOnUnauthorized(
	error: unknown,
	storage: AuthTokenStorage,
	redirect: (path: string) => void,
) {
	const isUnauthorized =
		typeof error === 'object' &&
		error !== null &&
		'data' in error &&
		(error as {data?: {code?: string}}).data?.code === 'UNAUTHORIZED'
	if (!isUnauthorized || !storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY)) return false

	finishLogout(storage, redirect)
	return true
}

export function finishBrowserLogout() {
	finishLogout(window.localStorage, (path) => {
		window.location.href = path
	})
}
