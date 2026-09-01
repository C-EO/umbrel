import {useQueryClient} from '@tanstack/react-query'
import {getQueryKey} from '@trpc/react-query'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {monthStartUtc, type MonthKey} from '@/features/photos/components/listing/time-rail/rail-scale'
import type {ItemFilter, ItemsPage} from '@/features/photos/hooks/use-items'
import {trpcReact} from '@/trpc/trpc'

// Jumping past the loading frontier. Keyset pagination can only walk
// forward, so a jump to a month nothing has loaded yet is a run of pages.
// The seek fetches them at the contract's ceiling — 1000 a page, however
// small the session's own page size — and splices each into the same
// infinite-query cache every list shares: cursors are opaque positions, not
// offsets, so pages of different lengths chain fine, and everything reading
// the list (the grid, the lightbox, ⌘A) sees the pages land as if the user
// had scrolled there.
//
// While a seek runs the grid's own load-ahead must stand down (it gates on
// `busy`): both would chain a fetch from the same tail cursor, and the same
// page would splice in twice.

const SEEK_LIMIT = 1000
// However deep the target, stop somewhere: 500 pages is half a million items
const SEEK_MAX_PAGES = 500
// An in-flight page the grid's load-ahead already started must land before
// the first splice. Wait it out, bounded.
const FETCH_WAIT_MS = 50
const FETCH_WAIT_MAX = 100

export type SeekOutcome = 'reached' | 'exhausted' | 'cancelled'

export type Seek = {
	// While true the grid must not page on its own (see the load-ahead effect)
	busy: boolean
	// The month being sought — what the rail's pill names; null at rest
	target: MonthKey | null
	start: (key: MonthKey, done: (outcome: SeekOutcome) => void) => void
	cancel: () => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The oldest loaded item across pages (a trailing page can be empty)
function oldestLoaded(pages: ItemsPage[]) {
	for (let index = pages.length - 1; index >= 0; index--) {
		const {items} = pages[index]!
		if (items.length > 0) return items[items.length - 1]
	}
	return undefined
}

export function useSeek({filter, pageSize}: {filter: ItemFilter; pageSize: number}): Seek {
	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()
	const [target, setTarget] = useState<MonthKey | null>(null)
	// True from a run's start until it fully drains — past a cancel, whose
	// in-flight page still lands and splices; only then may the grid page again
	const [draining, setDraining] = useState(false)
	const runRef = useRef<{cancelled: boolean} | null>(null)

	const cancel = useCallback(() => {
		if (runRef.current) runRef.current.cancelled = true
		setTarget(null)
	}, [])
	// Leaving the listing abandons the run (the grid remounts per filter)
	useEffect(() => cancel, [cancel])

	const start = useCallback(
		(key: MonthKey, done: (outcome: SeekOutcome) => void) => {
			if (runRef.current) runRef.current.cancelled = true
			const run = {cancelled: false}
			runRef.current = run
			setTarget(key)
			setDraining(true)
			const input = {filter, limit: pageSize}
			const infiniteKey = getQueryKey(trpcReact.photos.items.list, input, 'infinite')
			const loop = async (): Promise<SeekOutcome> => {
				const end = monthStartUtc(key + 1)
				for (let waited = 0; queryClient.isFetching({queryKey: infiniteKey}) > 0 && waited < FETCH_WAIT_MAX; waited++) {
					if (run.cancelled) return 'cancelled'
					await sleep(FETCH_WAIT_MS)
				}
				for (let page = 0; page < SEEK_MAX_PAGES; page++) {
					if (run.cancelled) return 'cancelled'
					const data = utils.photos.items.list.getInfiniteData(input)
					if (!data || data.pages.length === 0) return 'cancelled'
					const oldest = oldestLoaded(data.pages)
					if (oldest && oldest.takenAt < end) return 'reached'
					const cursor = data.pages[data.pages.length - 1]!.nextCursor
					if (cursor === undefined) return 'exhausted'
					const fetched = await utils.client.photos.items.list.query({filter, cursor, limit: SEEK_LIMIT})
					utils.photos.items.list.setInfiniteData(input, (current) => {
						// Splice only onto the tail this page was fetched from —
						// if anything moved it (it shouldn't, the grid is gated),
						// drop the page and let the next lap re-read
						if (!current || current.pages[current.pages.length - 1]?.nextCursor !== cursor) return current
						return {pages: [...current.pages, fetched], pageParams: [...current.pageParams, cursor]}
					})
				}
				return 'exhausted'
			}
			void loop().then((outcome) => {
				if (runRef.current === run) {
					runRef.current = null
					setTarget(null)
					setDraining(false)
				}
				done(run.cancelled ? 'cancelled' : outcome)
			})
		},
		[filter, pageSize, queryClient, utils],
	)

	return useMemo(() => ({busy: draining || target !== null, target, start, cancel}), [draining, target, start, cancel])
}
