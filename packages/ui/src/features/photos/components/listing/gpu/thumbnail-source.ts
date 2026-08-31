// What to fetch, in what order, and how much of it at once.
//
// There is no queue here and no cancellation bookkeeping. The wanted set *is*
// the items on screen, the order *is* nearest the focal point first, and both
// are recomputed from the current view — so a tile that scrolls or zooms away
// is dropped by construction rather than cancelled by something that
// remembered to. What is left is a cap, an outward walk and six promises.
//
// The cap is the browser's own. umbreld is plain HTTP/1.1, so a browser opens
// six connections per origin; a seventh request queues *inside* the browser,
// where we can no longer reorder or usefully cancel it. Making our cap the
// browser's cap means our queue is the only queue, and the careful ordering
// survives.
//
// Ordering is the anti-popcorn mechanism. Because arrivals come outward from
// where the eye is, the fill reads as a wave from the focal point; a stagger
// timer would be worse, because it decouples the animation from the truth.

import type {Item} from '@/features/photos/hooks/use-items'

// Six connections per origin, of which at most two may be spent making a
// thumbnail that does not exist yet — that runs ImageMagick inside the
// request, and a freshly imported folder must not starve the fast path.
// (In production every thumbnail exists at import and this becomes a no-op.)
const CAP = 6
const GENERATE_CAP = 2
// Cold generation of a 12MP JPEG on a Pi genuinely takes seconds; killing it
// at five just wastes the work
const REQUEST_TIMEOUT_MS = 20_000
// Below this a 512px photo downscaled into the cell is indistinguishable from
// its own average colour, and asking for it would spend the whole thumbnail
// budget on pixels nobody can see
const FETCH_MIN_DEVICE_PX = 20
// After two failures in a row, stop asking for a moment
const FAIL_PAUSE_MS = 2000
// Round-trip time, smoothed, decides how many we dare have in flight
const EWMA_WEIGHT = 0.2

export type ThumbnailHost = {
	// The thumbnail's authorized URL, when the backend already has one
	known: (item: Item) => string | undefined
	// … and the on-demand path for asking the backend to make one
	generate: (item: Item) => Promise<string | undefined>
	// The atlas's current cell size, in device pixels
	cell: () => number
	// What the atlas already has, so nothing is asked for twice
	holds: (index: number, id: string) => boolean
	deliver: (index: number, id: string, bitmap: ImageBitmap) => void
}

export class ThumbnailSource {
	// While a flick is crossing column counts faster than the pipeline could
	// possibly keep up with, ask for nothing at all
	suspended = false

	#host: ThumbnailHost
	#items: Item[] = []
	#range = {start: 0, end: -1}
	#focal = 0
	#tile = 0
	#step = 0
	// Where the outward walk first passed over an item that needed making
	// while the generation lane was full, so it can be picked up again
	#deferred: number | undefined
	#pending = new Map<string, {step: number; index: number; abort: () => void}>()
	#generating = 0
	#failed = new Set<string>()
	#failures = 0
	#pausedUntil = 0
	#ewma = 0
	#disposed = false

	constructor(host: ThumbnailHost) {
		this.#host = host
	}

	// The band on screen, where the eye is in it, and how many device pixels a
	// tile covers. Everything in flight that is no longer wanted is dropped
	// here; everything wanted is asked for in order.
	want(items: Item[], range: {start: number; end: number}, focal: number, devicePx: number) {
		if (this.#disposed) return
		const at = Math.min(range.end, Math.max(range.start, focal))
		// The walk is one pass outward from the focal point, so anything that
		// moves either the band or the point it radiates from starts it again;
		// carrying on from where it was would leave the ground between the two
		// unasked for. So does a change of cell size, which leaves behind cells
		// the walk passed over as held.
		const moved =
			this.#items !== items ||
			range.start !== this.#range.start ||
			range.end !== this.#range.end ||
			at !== this.#focal ||
			devicePx !== this.#tile
		this.#items = items
		this.#range = range
		this.#focal = at
		this.#tile = devicePx
		if (moved) {
			this.#step = 0
			this.#deferred = undefined
		}
		for (const [id, request] of this.#pending) {
			if (this.#wanted(request.index, id)) continue
			request.abort()
			this.#pending.delete(id)
		}
		this.#dispatch()
	}

	dispose() {
		this.#disposed = true
		for (const request of this.#pending.values()) request.abort()
		this.#pending.clear()
	}

	#wanted(index: number, id: string) {
		return index >= this.#range.start && index <= this.#range.end && this.#items[index]?.id === id
	}

	// Six at a time when the device is keeping up, fewer when it is not
	get #cap() {
		return this.#ewma < 250 ? CAP : this.#ewma < 800 ? 4 : 2
	}

	// The next item to ask for: outward from the focal point, alternating up
	// and down, which within a row runs outward from the focal column too. One
	// pass over the band per view, not a heap rebuilt on every scroll.
	#next() {
		const {start, end} = this.#range
		const reach = Math.max(this.#focal - start, end - this.#focal)
		while (this.#step <= 2 * reach + 1) {
			const step = this.#step++
			const index = this.#focal + (step % 2 === 0 ? step / 2 : -(step + 1) / 2)
			if (index < start || index > end) continue
			const item = this.#items[index]
			if (!item || this.#failed.has(item.id) || this.#pending.has(item.id)) continue
			if (this.#host.holds(index, item.id)) continue
			return {step, index, item}
		}
		return undefined
	}

	#dispatch() {
		if (this.suspended || this.#tile < FETCH_MIN_DEVICE_PX) return
		if (performance.now() < this.#pausedUntil) return
		// The generation lane has freed up: go back for what it made us skip
		if (this.#deferred !== undefined && this.#generating < GENERATE_CAP) {
			this.#step = Math.min(this.#step, this.#deferred)
			this.#deferred = undefined
		}
		while (this.#pending.size < this.#cap) {
			const next = this.#next()
			if (!next) return
			if (!this.#fetch(next.step, next.index, next.item)) this.#deferred ??= next.step
		}
	}

	// False when the generation lane is full, so a folder with no thumbnails
	// yet cannot fill all six connections. (In production every thumbnail
	// exists at import and this never fires.)
	#fetch(step: number, index: number, item: Item) {
		const known = this.#host.known(item)
		if (!known && this.#generating >= GENERATE_CAP) return false
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
		// This request, not whichever is pending for the item when it settles:
		// an abort resolves a turn later, by which time the item may have come
		// back into the band and been asked for again
		const request = {step, index, abort: () => controller.abort()}
		this.#pending.set(item.id, request)
		if (!known) this.#generating++
		const started = performance.now()
		const settle = () => {
			clearTimeout(timer)
			if (!known) this.#generating--
			if (this.#pending.get(item.id) === request) this.#pending.delete(item.id)
		}
		// Settled without delivering while the tile is still on screen — a
		// timeout, or the atlas moved to another cell size while this was in
		// flight — so the walk, which has passed it by now, goes back for it
		const revisit = () => {
			if (this.#wanted(index, item.id)) this.#step = Math.min(this.#step, step)
		}

		const run = async () => {
			const url = known ?? (await this.#host.generate(item))
			if (!url || controller.signal.aborted) return undefined
			const response = await fetch(url, {signal: controller.signal})
			if (!response.ok) throw new Error(`[thumbnail-${response.status}]`)
			// The cell as it is now, not as it was when this was asked for: the
			// atlas may have re-tiered while the bytes were on their way
			return decode(await response.blob(), this.#host.cell(), controller.signal)
		}

		run().then(
			(bitmap) => {
				settle()
				if (this.#disposed) return bitmap?.close()
				if (!bitmap) {
					// Our own abort — or nothing to fetch, which is final
					if (controller.signal.aborted) revisit()
					else this.#failed.add(item.id)
					this.#dispatch()
					return
				}
				this.#ewma = this.#ewma === 0 ? performance.now() - started : mix(this.#ewma, performance.now() - started)
				this.#failures = 0
				if (this.#wanted(index, item.id) && bitmap.width === this.#host.cell()) {
					this.#host.deliver(index, item.id, bitmap)
				} else {
					bitmap.close()
					revisit()
				}
				this.#dispatch()
			},
			(error: unknown) => {
				settle()
				if (this.#disposed) return
				// An abort is us changing our mind, not the device failing
				if (error instanceof DOMException && error.name === 'AbortError') {
					revisit()
				} else {
					this.#failed.add(item.id)
					if (++this.#failures >= 2) this.#pausedUntil = performance.now() + FAIL_PAUSE_MS
				}
				this.#dispatch()
			},
		)
		return true
	}
}

const mix = (previous: number, sample: number) => previous * (1 - EWMA_WEIGHT) + sample * EWMA_WEIGHT

// The thumbnail keeps the photo's aspect and a cell is square, so the centre
// square is cropped out on the way in — the same crop `object-fit: cover`
// makes on the DOM path. `createImageBitmap` decodes off the main thread in
// every engine we ship to, which is why there is no worker here: six of these
// at once could absorb over a thousand a second, and the device caps us at
// tens.
let scratch: HTMLCanvasElement | undefined

async function decode(blob: Blob, cell: number, signal: AbortSignal) {
	const source = await createImageBitmap(blob)
	if (signal.aborted) {
		source.close()
		return undefined
	}
	const crop = Math.min(source.width, source.height)
	const left = (source.width - crop) >> 1
	const top = (source.height - crop) >> 1
	try {
		const bitmap = await createImageBitmap(source, left, top, crop, crop, {
			resizeWidth: cell,
			resizeHeight: cell,
			resizeQuality: 'high',
		})
		if (bitmap.width === cell && bitmap.height === cell) {
			source.close()
			return bitmap
		}
		bitmap.close()
	} catch {
		// An engine without resize options: the canvas below does the same job
	}
	scratch ??= document.createElement('canvas')
	scratch.width = cell
	scratch.height = cell
	const context = scratch.getContext('2d')!
	context.imageSmoothingQuality = 'high'
	context.drawImage(source, left, top, crop, crop, 0, 0, cell, cell)
	source.close()
	return createImageBitmap(scratch)
}
