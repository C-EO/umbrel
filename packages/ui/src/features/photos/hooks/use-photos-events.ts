import {useQueryClient, type InfiniteData} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

import {ITEMS_LIST_KEY, type ItemsPage} from '@/features/photos/hooks/use-items'
import {trpcReact} from '@/trpc/trpc'

// A list with this many pages or fewer is cheap to refresh in place; deeper
// lists are only marked stale, so a scrolled-deep user isn't hit with dozens
// of page refetches because a file changed somewhere.
const REFETCH_IN_PLACE_MAX_PAGES = 3

// One subscription for the whole Photos surface. `photos:change` covers
// library mutations and indexed enrichment; `files:watcher:change` gives the
// UI immediate feedback for filesystem changes. Bursts collapse into one
// invalidation pass per second.
export function usePhotosEvents() {
	const utils = trpcReact.useUtils()
	const queryClient = useQueryClient()
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

	const schedule = () => {
		timerRef.current ??= setTimeout(() => {
			timerRef.current = undefined
			// Everything except the item lists: small queries, refetch outright
			void utils.photos.library.invalidate()
			void utils.photos.sources.invalidate()
			void utils.photos.albums.invalidate()
			void utils.photos.items.get.invalidate()
			// Item lists: refetch shallow ones, mark deep ones stale for their next mount
			void queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'none'})
			for (const query of queryClient.getQueryCache().findAll({queryKey: ITEMS_LIST_KEY})) {
				const pages = (query.state.data as InfiniteData<ItemsPage> | undefined)?.pages.length ?? 0
				if (pages <= REFETCH_IN_PLACE_MAX_PAGES && query.getObserversCount() > 0) void query.fetch()
			}
		}, 1000)
	}

	useEffect(() => () => clearTimeout(timerRef.current), [])

	trpcReact.eventBus.listen.useSubscription(
		{event: 'photos:change'},
		{
			onData: schedule,
			onError: (err) => console.error('eventBus.listen(photos:change)', err),
		},
	)
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:watcher:change'},
		{
			onData: schedule,
			onError: (err) => console.error('eventBus.listen(files:watcher:change)', err),
		},
	)
}
