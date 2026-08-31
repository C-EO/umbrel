import {useQueryClient, type InfiniteData} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

import {ITEMS_LIST_KEY, type ItemsPage} from '@/features/photos/hooks/use-items'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'

type LibraryStatus = RouterOutput['photos']['library']['status']

// A list with this many pages or fewer is cheap to refresh in place; deeper
// lists are only marked stale, so a scrolled-deep user isn't hit with dozens
// of page refetches because a file changed somewhere.
const REFETCH_IN_PLACE_MAX_PAGES = 3

// One subscription group for the whole Photos surface. Indexing snapshots go
// straight into the status cache; `photos:change` covers library mutations and
// indexed enrichment, while `files:watcher:change` gives immediate feedback for
// filesystem changes. Invalidation bursts collapse into one pass per second.
export function usePhotosEvents() {
	const utils = trpcReact.useUtils()
	const queryClient = useQueryClient()
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
	const indexingVersionRef = useRef(0)

	const schedule = () => {
		timerRef.current ??= setTimeout(() => {
			timerRef.current = undefined
			// Everything except the item lists: small queries, refetch outright
			void utils.photos.library.summary.invalidate()
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
		{event: 'photos:indexing-progress'},
		{
			onData: (state) => {
				const version = ++indexingVersionRef.current
				const nextState = state as LibraryStatus
				// An event can overtake the initial status query. Cancel that older
				// response before publishing the authoritative streamed snapshot.
				void utils.photos.library.status.cancel().then(() => {
					if (version === indexingVersionRef.current) {
						const previousState = utils.photos.library.status.getData()
						utils.photos.library.status.setData(undefined, nextState)
						// A reconnect can seed ready after its matching photos:change was
						// missed. Reuse the bounded list refresh instead of refetching every
						// page of a deep timeline.
						if (nextState.phase === 'ready' && previousState && previousState.phase !== 'ready') schedule()
					}
				})
			},
			onError: (err) => console.error('eventBus.listen(photos:indexing-progress)', err),
		},
	)

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
