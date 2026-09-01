// A small gate in front of DOM thumbnail <img>s. Without it, mounting a new
// virtualized window gives every image a src at once and the browser builds its
// own FIFO queue in DOM order — including the overscan above the viewport. By
// admitting only a handful at a time, the next free slot can always go to the
// item closest to what is visible now.

const CAPACITY = 5
const STALL_MS = 20_000

export type ThumbnailRequestSlot = {
	// The tile left the render window. A waiting request disappears; a granted
	// request frees its admission slot after the caller has cleared the raw
	// <img>'s source, cancelling work that is no longer useful.
	release: () => void
	// The image loaded or failed, so another request may start.
	settle: () => void
}

type Waiting = {index: () => number; grant: () => void}
type Priority = {tier: number; distance: number}

export class ThumbnailQueue {
	// Read only when a slot is available, so scrolling reprioritizes waiting
	// work without causing a React render. The grid supplies visible-vs-overscan
	// tiering and distance from the middle of the viewport.
	priority: (index: number) => Priority = (index) => ({tier: 0, distance: index})

	#capacity: number
	#stallMs: number
	#waiting = new Map<symbol, Waiting>()
	#inFlight = 0
	#scheduled = false

	constructor({capacity = CAPACITY, stallMs = STALL_MS}: {capacity?: number; stallMs?: number} = {}) {
		this.#capacity = capacity
		this.#stallMs = stallMs
	}

	enqueue(index: () => number, grant: () => void): ThumbnailRequestSlot {
		const key = Symbol()
		let state: 'waiting' | 'flying' | 'done' = 'waiting'
		let timer: ReturnType<typeof setTimeout> | undefined

		const finish = () => {
			if (state !== 'flying') return
			state = 'done'
			clearTimeout(timer)
			this.#inFlight--
			this.#dispatch()
		}
		const start = () => {
			if (state !== 'waiting') return
			state = 'flying'
			this.#inFlight++
			timer = setTimeout(finish, this.#stallMs)
			try {
				grant()
			} catch (error) {
				finish()
				throw error
			}
		}

		this.#waiting.set(key, {index, grant: start})
		// Effects register every tile in one turn. Waiting for the microtask lets
		// the whole visible band enter before choosing the first five, rather than
		// immediately granting the first overscan items mounted in DOM order.
		this.#schedule()

		return {
			release: () => {
				if (state === 'waiting') {
					state = 'done'
					this.#waiting.delete(key)
					return
				}
				finish()
			},
			settle: finish,
		}
	}

	#schedule() {
		if (this.#scheduled) return
		this.#scheduled = true
		queueMicrotask(() => {
			this.#scheduled = false
			this.#dispatch()
		})
	}

	#dispatch() {
		while (this.#inFlight < this.#capacity && this.#waiting.size > 0) {
			let best: [symbol, Waiting] | undefined
			let bestPriority: Priority | undefined
			for (const entry of this.#waiting) {
				const priority = this.priority(entry[1].index())
				if (
					!bestPriority ||
					priority.tier < bestPriority.tier ||
					(priority.tier === bestPriority.tier && priority.distance < bestPriority.distance)
				) {
					best = entry
					bestPriority = priority
				}
			}
			this.#waiting.delete(best![0])
			best![1].grant()
		}
	}
}
