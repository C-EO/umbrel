// Shared query definition for the optional storefront feed, used by the
// Discover/category pages and by the idle Prefetcher so the fetch itself is
// defined exactly once.
//
// Failure policy: a slow, blocked, malformed or offline apps.umbrel.com must
// never degrade the local store, so the request has a short timeout, never
// retries, sends no credentials/referrer, and errors are simply treated as
// "no editorial content" by the UI (no toasts, no error cards).

import {queryOptions} from '@tanstack/react-query'

import {APP_STORE_REMOTE_API_BASE} from '@/features/app-store/constants'
import {parseStorefront, type Storefront} from '@/features/app-store/data/storefront'

export const REMOTE_TIMEOUT_MS = 3000

// The feed is editorial, not operational — refreshing it mid-session has no
// user value, so keep it fresh for the session and let HTTP caching handle
// the rest across sessions. The cache lifetime matches: with react-query's
// default 5-minute gcTime the prefetched feed (and the feed from a previous
// visit — closing the store unmounts its only observer) would be evicted, so
// reopening the store would compose Discover twice: first the local catalog
// alone, then the editorial sections landing on top of it.
const STALE_TIME_MS = 60 * 60 * 1000
const GC_TIME_MS = STALE_TIME_MS

export function remoteJsonFetcher(url: string) {
	return async ({signal}: {signal?: AbortSignal} = {}): Promise<unknown> => {
		const timeoutSignal = AbortSignal.timeout(REMOTE_TIMEOUT_MS)
		const response = await fetch(url, {
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			signal: signal && 'any' in AbortSignal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
		})
		if (!response.ok) throw new Error(`Unexpected status ${response.status}`)
		if (!response.headers.get('content-type')?.includes('application/json')) {
			throw new Error('Unexpected content type')
		}
		return response.json()
	}
}

const fetchStorefrontJson = remoteJsonFetcher(`${APP_STORE_REMOTE_API_BASE}/storefront`)

export function storefrontQueryOptions() {
	return queryOptions<Storefront>({
		queryKey: ['app-store', 'storefront'],
		queryFn: async ({signal}) => {
			const json = (await fetchStorefrontJson({signal})) as {data?: unknown}
			return parseStorefront(json?.data)
		},
		retry: false,
		staleTime: STALE_TIME_MS,
		gcTime: GC_TIME_MS,
	})
}
