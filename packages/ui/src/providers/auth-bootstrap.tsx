import {useEffect} from 'react'

import {AUTH_TOKEN_LOCAL_STORAGE_KEY, clearAuthToken} from '@/modules/auth/token-renewal'
import {trpcReact} from '@/trpc/trpc'

// Clear a stale token at page load if umbreld reports we're not logged in.
// Without this, a stale token can cause WS auth failures and redirect loops
// because we have a tRPC split-link that prefers WS when a token exists.
export function AuthBootstrap() {
	const isLoggedInQ = trpcReact.user.isLoggedIn.useQuery(undefined)

	useEffect(() => {
		// Wait until the server answers definitively
		if (!isLoggedInQ.isSuccess) return

		// If the server says we're not logged in but a token exists locally,
		// it's stale (e.g., after session revocation, restore, or reinstall).
		const isLoggedIn = Boolean(isLoggedInQ.data)
		const hasAuthToken = Boolean(localStorage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY))

		// If we're already logged in or there is no token to clear, do nothing.
		if (isLoggedIn || !hasAuthToken) return

		// Clear the stale token and hard-navigate to login page so guards and split-link
		// recompute state without a token.
		clearAuthToken(localStorage)
		window.location.replace('/login')
	}, [isLoggedInQ.isSuccess, isLoggedInQ.data])

	return null
}
