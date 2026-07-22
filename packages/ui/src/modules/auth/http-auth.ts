import {AUTH_TOKEN_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {trpcClient, trpcReact} from '@/trpc/trpc'

import {authorizedUrlState, withHttpApiToken} from './authorized-url'

export type AuthorizedHttpUrlQuery = ReturnType<typeof useAuthorizedHttpUrlQuery>

export function dashboardAuthHeaders(): Record<string, string> {
	const token = localStorage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY)
	return token ? {Authorization: `Bearer ${token}`} : {}
}

export async function authorizedHttpUrl(url: string) {
	const token = await trpcClient.user.getHttpApiToken.query()
	return withHttpApiToken(url, token)
}

export function useAuthorizedHttpUrlQuery(url: string | undefined) {
	const tokenQuery = trpcReact.user.getHttpApiToken.useQuery(undefined, {
		enabled: Boolean(url),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	})
	return {
		...authorizedUrlState(url, tokenQuery.data, tokenQuery.isError),
		isRetrying: tokenQuery.isFetching,
		retry: () => void tokenQuery.refetch(),
	}
}

export function useAuthorizedHttpUrl(url: string | undefined) {
	return useAuthorizedHttpUrlQuery(url).url
}
