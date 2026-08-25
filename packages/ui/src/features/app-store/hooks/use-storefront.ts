import {useQuery} from '@tanstack/react-query'

import {resolveStorefront, type ResolvedStorefront} from '@/features/app-store/data/storefront'
import {storefrontQueryOptions} from '@/features/app-store/data/storefront-query'
import {useAvailableApps} from '@/providers/available-apps'

const emptyStorefront: ResolvedStorefront = {
	sections: [],
	featuredByCategory: new Map(),
	dates: new Map(),
}

/**
 * The optional editorial storefront, resolved against the local registry.
 * Without feed data (failed, malformed, blocked, offline) this simply returns
 * an empty storefront — the complete local experience renders instead.
 *
 * `isLoading` is true only while the feed's first attempt is in flight (bounded
 * by the request timeout). Discover holds its render so it composes once,
 * editorial sections and catalog together, instead of the catalog
 * appearing alone and the sections landing on top of it a beat later. A feed
 * that has already failed is never waited for again: its retry happens in the
 * background, and when it succeeds the sections enhance the page in place.
 *
 * `isUnavailable` is true once the feed has failed or cannot be attempted
 * (browser offline) and nothing cached remains to show, letting navigation
 * fall back to All apps.
 */
export function useStorefront(): ResolvedStorefront & {isLoading: boolean; isUnavailable: boolean} {
	const storefrontQ = useQuery(storefrontQueryOptions())
	const availableApps = useAvailableApps()

	// react-query reports a retried query as pending (not errored) while the
	// retry is in flight; the error count remembers that it has failed before
	const hasFailed = storefrontQ.isError || storefrontQ.errorUpdateCount > 0
	const isLoading = !storefrontQ.data && !hasFailed && storefrontQ.isLoading
	const isUnavailable = !storefrontQ.data && (hasFailed || storefrontQ.isPaused)

	if (!storefrontQ.data || availableApps.isLoading || !availableApps.appsKeyed) {
		return {...emptyStorefront, isLoading, isUnavailable}
	}

	return {
		...resolveStorefront(storefrontQ.data, availableApps.appsKeyed, availableApps.appsGroupedByCategory ?? {}),
		isLoading,
		isUnavailable,
	}
}
