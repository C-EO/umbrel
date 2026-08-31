// Every way to pinch the grid, said once.
//
// A pinch is a factor on whatever the zoom was when it started, so two fingers
// on a phone, a trackpad in Safari and ctrl/⌘ + wheel everywhere else are the
// same gesture in three dialects: `start` says where the eye is, `move`
// reports the factor so far — and, for touch, how far the midpoint has
// travelled, because a pinch pans as well as zooms — and `end` lets go.
// Nothing here knows what a column is.
//
// Two of these three do not exist in the app today: iPads and phones have had
// only the slider, and Safari fires `gesturestart`/`gesturechange` where
// Chrome and Firefox synthesise ctrl + wheel.

// Tile size change per wheel px, in log space
const WHEEL_RATE = 0.004
// A wheel gesture has no end event, so it ends when the wheel goes quiet
const WHEEL_IDLE_MS = 120

export type Pinch = {
	// A gesture began about this point, in the element's own viewport px
	start(focal: {x: number; y: number}): void
	// … and now asks for this factor on the zoom it began at, its midpoint
	// having travelled this far
	move(factor: number, pan: {x: number; y: number}): void
	end(): void
}

// Safari only; not in lib.dom
type GestureEvent = Event & {scale: number; clientX: number; clientY: number}

const midpoint = (a: Touch, b: Touch) => ({x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2})
const spread = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

export function attachPinch(el: HTMLElement, pinch: Pinch) {
	// Where the element is, read once per gesture: a pinch does not reflow
	let origin = {left: 0, top: 0}
	const local = (point: {x: number; y: number}) => ({x: point.x - origin.left, y: point.y - origin.top})
	const begin = (focal: {x: number; y: number}) => {
		const bounds = el.getBoundingClientRect()
		origin = {left: bounds.left, top: bounds.top}
		pinch.start(local(focal))
	}

	// Touch owns the gesture while two fingers are down, so iOS — which fires
	// both — is not counted twice
	let touch: {spread: number; mid: {x: number; y: number}} | null = null

	const onTouchStart = (event: TouchEvent) => {
		if (event.touches.length !== 2) return
		const [a, b] = [event.touches[0]!, event.touches[1]!]
		const mid = midpoint(a, b)
		touch = {spread: spread(a, b), mid}
		begin(mid)
	}
	const onTouchMove = (event: TouchEvent) => {
		if (!touch || event.touches.length !== 2) return
		// The scroller must not also scroll: two fingers are the zoom's
		event.preventDefault()
		const [a, b] = [event.touches[0]!, event.touches[1]!]
		const mid = midpoint(a, b)
		pinch.move(spread(a, b) / Math.max(touch.spread, 1), {x: mid.x - touch.mid.x, y: mid.y - touch.mid.y})
	}
	const onTouchEnd = (event: TouchEvent) => {
		if (!touch || event.touches.length >= 2) return
		touch = null
		pinch.end()
	}

	// macOS Safari's trackpad pinch. preventDefault on the start also stops the
	// browser zooming the page under us.
	let gesturing = false
	const onGestureStart = (event: Event) => {
		if (touch) return
		event.preventDefault()
		gesturing = true
		const {clientX, clientY} = event as GestureEvent
		begin({x: clientX, y: clientY})
	}
	const onGestureChange = (event: Event) => {
		if (!gesturing) return
		event.preventDefault()
		pinch.move((event as GestureEvent).scale, {x: 0, y: 0})
	}
	const onGestureEnd = (event: Event) => {
		if (!gesturing) return
		event.preventDefault()
		gesturing = false
		pinch.end()
	}

	// A trackpad pinch reaches Chrome and Firefox as ctrl + wheel; ⌘ + wheel is
	// the mouse's way in. Both accumulate into the same factor, and the gesture
	// ends when the wheel stops.
	let factor = 0
	let idle: ReturnType<typeof setTimeout> | undefined
	const endWheel = () => {
		clearTimeout(idle)
		idle = undefined
		factor = 0
		pinch.end()
	}
	const onWheel = (event: WheelEvent) => {
		if (!event.ctrlKey && !event.metaKey) return
		event.preventDefault()
		if (touch || gesturing) return
		if (!factor) {
			factor = 1
			begin({x: event.clientX, y: event.clientY})
		}
		clearTimeout(idle)
		idle = setTimeout(endWheel, WHEEL_IDLE_MS)
		factor *= Math.exp(-event.deltaY * WHEEL_RATE)
		pinch.move(factor, {x: 0, y: 0})
	}

	el.addEventListener('touchstart', onTouchStart, {passive: true})
	el.addEventListener('touchmove', onTouchMove, {passive: false})
	el.addEventListener('touchend', onTouchEnd, {passive: true})
	el.addEventListener('touchcancel', onTouchEnd, {passive: true})
	el.addEventListener('gesturestart', onGestureStart, {passive: false})
	el.addEventListener('gesturechange', onGestureChange, {passive: false})
	el.addEventListener('gestureend', onGestureEnd, {passive: false})
	el.addEventListener('wheel', onWheel, {passive: false})

	return () => {
		el.removeEventListener('touchstart', onTouchStart)
		el.removeEventListener('touchmove', onTouchMove)
		el.removeEventListener('touchend', onTouchEnd)
		el.removeEventListener('touchcancel', onTouchEnd)
		el.removeEventListener('gesturestart', onGestureStart)
		el.removeEventListener('gesturechange', onGestureChange)
		el.removeEventListener('gestureend', onGestureEnd)
		el.removeEventListener('wheel', onWheel)
		clearTimeout(idle)
	}
}
