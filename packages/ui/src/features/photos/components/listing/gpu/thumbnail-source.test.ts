import {afterEach, describe, expect, it, vi} from 'vitest'

import type {Item} from '@/features/photos/hooks/use-items'

import {ThumbnailSource} from './thumbnail-source'

// The scheduler against a fake backend: every fetch is held until the test
// settles it, the atlas is a map of what has been delivered, and decoding
// yields a bitmap of whatever cell size the source asks for.
function harness({count = 40, known = () => true}: {count?: number; known?: (index: number) => boolean} = {}) {
	// URLs the host already knows, by id — items themselves carry no URL field
	const urls = new Map<string, string | undefined>()
	const items = Array.from({length: count}, (_, index) => {
		urls.set(`i${index}`, known(index) ? `/t/${index}` : undefined)
		return {id: `i${index}`} as unknown as Item
	})
	const resident = new Map<number, string>()
	const delivered: number[] = []
	const requests: {index: number; settle: (ok?: boolean) => void; signal: AbortSignal; done: boolean}[] = []
	const generating: {index: number; resolve: (url: string | undefined) => void}[] = []
	let cell = 32
	// Called between decoding and delivery, for a test to change its mind then
	let beforeResize: (() => void) | undefined

	vi.stubGlobal(
		'fetch',
		(url: string, init: {signal: AbortSignal}) =>
			new Promise((resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				const request = {
					index: Number(url.slice(3)),
					settle: (ok = true) => {
						request.done = true
						if (ok) resolve({ok: true, blob: async () => new Blob()})
						else reject(new Error('net'))
					},
					signal: init.signal,
					done: false,
				}
				requests.push(request)
			}),
	)
	vi.stubGlobal('createImageBitmap', async (_source: unknown, ...rest: unknown[]) => {
		const options = rest[4] as {resizeWidth: number} | undefined
		if (options) beforeResize?.()
		const size = options?.resizeWidth ?? 512
		return {width: size, height: size, close() {}}
	})

	const source = new ThumbnailSource({
		known: (item) => urls.get(item.id),
		generate: (item) => new Promise((resolve) => generating.push({index: Number(item.id.slice(1)), resolve})),
		cell: () => cell,
		holds: (index, id) => resident.get(index) === id,
		deliver: (index, id, bitmap) => {
			resident.set(index, id)
			delivered.push(index)
			bitmap.close()
		},
	})
	return {
		items,
		source,
		requests,
		generating,
		delivered,
		resident,
		pending: () =>
			requests.filter((request) => !request.done && !request.signal.aborted).map((request) => request.index),
		setCell: (next: number) => (cell = next),
		onResize: (hook: () => void) => (beforeResize = hook),
		want: (range: {start: number; end: number}, focal: number, devicePx = 64) =>
			source.want(items, range, focal, devicePx),
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('ThumbnailSource', () => {
	it('asks outward from the focal point, six at a time', () => {
		const h = harness()
		h.want({start: 0, end: 39}, 20)
		expect(h.pending()).toEqual([20, 19, 21, 18, 22, 17])
	})

	it('delivers what arrives and asks for the next', async () => {
		const h = harness()
		h.want({start: 0, end: 39}, 20)
		h.requests[0]!.settle()
		await vi.waitFor(() => expect(h.delivered).toEqual([20]))
		expect(h.pending()).toEqual([19, 21, 18, 22, 17, 23])
	})

	it('drops what the atlas already holds, and what has failed', async () => {
		const h = harness()
		h.resident.set(19, 'i19')
		h.resident.set(21, 'i21')
		h.want({start: 0, end: 39}, 20)
		expect(h.pending()).toEqual([20, 18, 22, 17, 23, 16])
		h.requests[0]!.settle(false)
		await vi.waitFor(() => expect(h.pending()).not.toContain(20))
		// A second want walks past the failure rather than asking again
		h.want({start: 0, end: 39}, 21)
		expect(h.pending()).not.toContain(20)
	})

	it('aborts what scrolled away, and asks for what scrolled in', () => {
		const h = harness()
		h.want({start: 0, end: 39}, 20)
		h.want({start: 30, end: 39}, 35)
		expect(h.requests.slice(0, 6).every((request) => request.signal.aborted)).toBe(true)
		expect(h.pending()).toEqual([35, 34, 36, 33, 37, 32])
	})

	it('asks for nothing below the smallest cell worth fetching, or while racing', () => {
		const h = harness()
		h.want({start: 0, end: 39}, 20, 8)
		expect(h.pending()).toEqual([])
		h.source.suspended = true
		h.want({start: 0, end: 39}, 20, 64)
		expect(h.pending()).toEqual([])
		h.source.suspended = false
		h.want({start: 0, end: 39}, 20, 64)
		expect(h.pending()).toHaveLength(6)
	})

	it('goes back for a request the atlas re-tiered under', async () => {
		const h = harness()
		h.want({start: 0, end: 39}, 20)
		// The first decode lands as the cell changes: its bitmap is the wrong
		// size and is dropped — and then asked for again, at the new size
		h.onResize(() => {
			h.setCell(40)
			h.onResize(() => {})
		})
		h.requests[0]!.settle()
		await vi.waitFor(() => expect(h.requests.filter((request) => request.index === 20)).toHaveLength(2))
		expect(h.delivered).toEqual([])
		h.requests.at(-1)!.settle()
		await vi.waitFor(() => expect(h.delivered).toEqual([20]))
	})

	it('goes back for a request that timed out', async () => {
		vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
		const h = harness()
		h.want({start: 0, end: 39}, 20)
		vi.advanceTimersByTime(20_001)
		await vi.waitFor(() => expect(h.requests.filter((request) => request.index === 20)).toHaveLength(2))
		expect(h.pending()).toContain(20)
	})

	it('walks the band again when the cell size changes', async () => {
		const h = harness({count: 7})
		h.want({start: 0, end: 6}, 3)
		for (const request of [...h.requests]) request.settle()
		await vi.waitFor(() => expect(h.delivered).toHaveLength(6))
		h.requests.at(-1)!.settle()
		await vi.waitFor(() => expect(h.delivered).toHaveLength(7))
		// The atlas moved to another cell and lost everything
		h.resident.clear()
		h.want({start: 0, end: 6}, 3, 80)
		expect(h.pending()).toEqual([3, 2, 4, 1, 5, 0])
	})

	it('walks the band again when the atlas re-tiers under an unchanged view', async () => {
		const h = harness({count: 7})
		h.want({start: 0, end: 6}, 3)
		for (const request of [...h.requests]) request.settle()
		await vi.waitFor(() => expect(h.delivered).toHaveLength(6))
		h.requests.at(-1)!.settle()
		await vi.waitFor(() => expect(h.delivered).toHaveLength(7))
		// Zooming back in re-tiered the atlas: the carried cells hold stretched
		// pixels the atlas no longer reports as held — but nothing else about
		// the view moved, so only the cell size can start the walk again
		h.resident.clear()
		h.setCell(64)
		h.want({start: 0, end: 6}, 3)
		expect(h.pending()).toEqual([3, 2, 4, 1, 5, 0])
	})

	it('keeps thumbnails being made to two of the six connections', async () => {
		const h = harness({known: (index) => index >= 10})
		h.want({start: 0, end: 39}, 5)
		// 5, 4, 6, 3 … have no thumbnail: two go to be made, then the walk
		// carries on to the ones that exist
		expect(h.generating.map((g) => g.index)).toEqual([5, 4])
		expect(h.pending()).toEqual([10, 11, 12, 13])
		h.generating[0]!.resolve('/t/5')
		await vi.waitFor(() => expect(h.pending()).toContain(5))
		// The lane is held until the thumbnail made is also fetched …
		expect(h.generating.map((g) => g.index)).toEqual([5, 4])
		h.requests.find((request) => request.index === 5)!.settle()
		// … and freeing it goes back for the one the walk skipped
		await vi.waitFor(() => expect(h.generating.map((g) => g.index)).toEqual([5, 4, 6]))
		expect(h.delivered).toEqual([5])
	})

	it('holds a band with no known URLs at all, and fills it when they come', async () => {
		// The hard-refresh shape: the canvas outran the token every URL is
		// signed with, so nothing is known — two wait in the generate lane,
		// nothing is fetched, and nothing is marked as having failed
		const h = harness({known: () => false})
		h.want({start: 0, end: 39}, 20)
		expect(h.generating.map((g) => g.index)).toEqual([20, 19])
		expect(h.pending()).toEqual([])
		// The token arrives: what was waiting fetches …
		h.generating[0]!.resolve('/t/20')
		h.generating[1]!.resolve('/t/19')
		await vi.waitFor(() => expect(h.pending()).toEqual([20, 19]))
		// … and each delivery carries the walk outward as usual
		h.requests.find((request) => request.index === 20)!.settle()
		await vi.waitFor(() => expect(h.delivered).toEqual([20]))
		expect(h.generating.map((g) => g.index)).toEqual([20, 19, 21])
	})

	it('asks again for what failed once authorization changes', async () => {
		const h = harness({count: 3})
		h.want({start: 0, end: 2}, 1)
		h.requests[0]!.settle(false)
		// The rejection unwinds a few microtasks deep; a macrotask outlasts it
		await new Promise((resolve) => setTimeout(resolve))
		expect(h.pending()).toEqual([0, 2])
		// A fresh token signs every URL anew: the failure no longer stands
		h.source.reauthorized()
		expect(h.pending()).toEqual([0, 2, 1])
	})
})
