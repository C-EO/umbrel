// The grid's zoom, as one number.
//
// `columns` is the only zoom state and it is a float. Every input maps to it —
// a two-finger pinch, Safari's trackpad gestures, ctrl/⌘ + wheel, the slider,
// the ± buttons — and everything the grid draws derives from it, so there is
// one thing to anchor, one thing to rubber-band and one thing to spring home.
//
// No DOM and no clock of its own: the grid advances this from the same frame
// loop it draws in, which is what keeps a live gesture off React's render path
// and what makes the whole thing testable.

import {SPRING} from '@/features/photos/components/listing/reflow-motion'

// Past a zoom limit the grid keeps moving, but less and less: a limit you can
// lean on rather than one you hit. In log space, so it feels the same at both
// ends, and asymptotically ~1.4× past either.
const RUBBER = 0.35

export function rubberClamp(columns: number, min: number, max: number) {
	const over = columns < min ? Math.log(min / columns) : columns > max ? Math.log(columns / max) : 0
	if (over <= 0) return columns
	const eased = (over * RUBBER) / (over + RUBBER)
	return columns < min ? min * Math.exp(-eased) : max * Math.exp(eased)
}

// Integration, matched to ReflowMotion's: frames longer than this (a hidden
// tab) are treated as this long, and integrated in sub-steps this short
const MAX_FRAME_S = 0.032
const STEP_S = 0.008
// At rest within a hundredth of a column — a fraction of a pixel of tile at
// every stop the grid offers — and this slow
const REST = 0.01
const REST_VELOCITY = 0.2

// A damped spring on one number, on the same constants the tiles fly home on.
// Re-aiming it in flight keeps its velocity, so an interrupted settle carries
// on rather than restarting.
export class ZoomSpring {
	value: number
	target: number
	velocity = 0

	constructor(value: number) {
		this.value = value
		this.target = value
	}

	to(target: number) {
		this.target = target
	}

	get atRest() {
		return Math.abs(this.value - this.target) < REST && Math.abs(this.velocity) < REST_VELOCITY
	}

	// Advance by `seconds`; false once it has arrived
	advance(seconds: number) {
		const {stiffness, damping, mass} = SPRING
		for (let remaining = Math.min(MAX_FRAME_S, seconds); remaining > 0; remaining -= STEP_S) {
			const step = Math.min(STEP_S, remaining)
			this.velocity += ((-stiffness * (this.value - this.target) - damping * this.velocity) / mass) * step
			this.value += this.velocity * step
		}
		if (!this.atRest) return true
		this.value = this.target
		this.velocity = 0
		return false
	}
}

// How fast the zoom is moving, over the last window. A flick from a 400px tile
// to a 14px one crosses a hundred and fifty column counts in half a second; a
// pipeline that tried to keep up would enqueue and cancel tens of thousands of
// requests it never wanted. A slow, deliberate pinch keeps filling as it goes.
const RATE_WINDOW_MS = 100
const RATE_LIMIT = 0.15

export class ZoomRate {
	#history: {at: number; columns: number}[] = []
	racing = false

	sample(columns: number, at: number) {
		const history = this.#history
		history.push({at, columns})
		while (history.length > 1 && at - history[1]!.at >= RATE_WINDOW_MS) history.shift()
		this.racing = Math.abs(columns - history[0]!.columns) > RATE_LIMIT * columns
	}

	reset() {
		this.#history.length = 0
		this.racing = false
	}
}

// What the grid draws on a frame of the gesture
export type ZoomFrame = {
	// The column count, fractional while a gesture or its settle owns the zoom
	columns: number
	// Whether the zoom is still moving. The last frame of a gesture is the
	// first with this false: that is where the grid commits.
	live: boolean
	// Where to zoom about, in the scroller's viewport px, when a pointer or a
	// pinch's midpoint set it; null leaves the grid its own focal point
	focal: {x: number; y: number} | null
	// How far the pinch's midpoint has travelled since it began: a pinch pans
	// as well as zooms, and one that only zoomed would feel nailed down
	pan: {x: number; y: number}
	// Moving too fast to be worth fetching pixels for
	racing: boolean
}

const NO_PAN = {x: 0, y: 0}

export class ZoomGesture {
	// The stops the grid offers right now. A gesture may lean past them; a
	// release lands back inside.
	range = {min: 2, max: 2}
	// Whether a gesture, or the spring that follows it, owns the zoom
	live = false

	#columns = 0
	// Where the gesture began, which is what a pinch's factor multiplies
	#from = 0
	#focal: {x: number; y: number} | null = null
	#pan = NO_PAN
	#spring: ZoomSpring | null = null
	#rate = new ZoomRate()

	get columns() {
		return this.#columns
	}

	// Take a column count the grid arrived at by other means — a resize, a
	// remembered preference, a settled commit
	adopt(columns: number) {
		if (this.live) return
		this.#columns = columns
	}

	// A gesture takes the zoom, about `focal`
	begin(focal: {x: number; y: number} | null) {
		this.#from = this.#columns
		this.#focal = focal
		this.#pan = NO_PAN
		this.#spring = null
		this.#rate.reset()
		this.live = true
	}

	// … and asks for a factor on where it began. Fingers spreading apart is a
	// factor above one, which is fewer columns and bigger tiles.
	scale(factor: number, pan = NO_PAN) {
		this.#pan = pan
		this.#request(this.#from / Math.max(factor, 1e-3))
	}

	// … or, from the slider, asks for a column count outright
	to(columns: number) {
		this.#request(columns)
	}

	#request(columns: number) {
		if (!this.live) this.begin(null)
		this.#columns = rubberClamp(columns, this.range.min, this.range.max)
		this.#spring = null
	}

	// … and lets go: the spring carries it to the nearest whole count, which
	// also undoes any rubber-band overshoot
	release(animate: boolean) {
		this.settle(Math.round(this.#clamped()), animate)
	}

	// A step that was never a gesture — a button, a key, a slider commit
	settle(columns: number, animate: boolean) {
		const target = Math.round(Math.min(this.range.max, Math.max(this.range.min, columns)))
		this.#rate.reset()
		if (!animate || target === this.#columns) {
			this.#columns = target
			this.#spring = null
			this.live = false
			return
		}
		const spring = this.#spring ?? new ZoomSpring(this.#columns)
		spring.value = this.#columns
		spring.to(target)
		this.#spring = spring
		this.live = true
	}

	// Give up wherever it is: an interrupted gesture, an unmount
	cancel() {
		this.#spring = null
		this.#rate.reset()
		this.live = false
	}

	#clamped() {
		return Math.min(this.range.max, Math.max(this.range.min, this.#columns))
	}

	// One frame. `live` goes false on the frame the zoom comes to rest, which
	// is the frame the grid commits a view on.
	advance(seconds: number, now: number): ZoomFrame {
		const spring = this.#spring
		if (spring) {
			if (!spring.advance(seconds)) {
				this.#spring = null
				this.live = false
			}
			this.#columns = spring.value
		}
		this.#rate.sample(this.#columns, now)
		return {
			columns: this.#columns,
			live: this.live,
			focal: this.#focal,
			pan: this.#pan,
			racing: this.live && this.#rate.racing,
		}
	}
}
