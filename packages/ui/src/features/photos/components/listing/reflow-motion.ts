// Spring motion for grid reflows, outside React.
//
// When the layout changes, the grid renders the new positions at once and asks
// this class to make each element *look* like it is still where it was: an
// offset (and a scale, for tiles that changed size) that a damped spring then
// pulls back to zero. Everything settles in one requestAnimationFrame loop
// that only writes `style.transform`, so a reflow costs no layout and no React
// render per frame. Re-seeding an element in flight — the slider crossed
// another stop — adds the new displacement to the current one and keeps its
// velocity, so the motion continues instead of restarting.
//
// Elements are composited (`will-change`) only from seed to rest: in flight a
// frame is a compositor update rather than a repaint of every image; at rest
// the page carries no extra layers.

// Slightly under critical damping (ζ ≈ 0.92): settles in ~350ms with an
// overshoot of a fraction of a pixel, so neighbouring tiles never overlap.
// Shared with the zoom's own settle (see zoom-gesture.ts), so a gesture
// letting go and a tile flying home move on the same curve.
export const SPRING = {stiffness: 380, damping: 36, mass: 1}
// Integration: frames longer than this (a hidden tab) are treated as this long
const MAX_FRAME_S = 0.032
// … and integrated in sub-steps this short, which keeps Euler stable and accurate
const STEP_S = 0.008
// Clamp on re-seed, so a flick through many stops can't wind the springs up
const MAX_VELOCITY = 3000
// At rest when within these of the target, in px, scale units and px/s
const REST_DISTANCE = 0.5
const REST_SCALE = 0.002
const REST_VELOCITY = 10

type Body = {
	el: HTMLElement
	x: number
	y: number
	scale: number
	vx: number
	vy: number
	vscale: number
}

export class ReflowMotion {
	private bodies = new Map<HTMLElement, Body>()
	private frame = 0
	private last = 0
	private onActive?: (active: boolean) => void

	constructor(onActive?: (active: boolean) => void) {
		this.onActive = onActive
	}

	// Make `el` appear `dx`,`dy` px from its new static position and `scale`
	// times its new size (about its top-left corner), then let it spring home
	seed(el: HTMLElement, dx: number, dy: number, scale = 1) {
		let body = this.bodies.get(el)
		if (!body) {
			if (Math.abs(dx) < REST_DISTANCE && Math.abs(dy) < REST_DISTANCE && Math.abs(scale - 1) < REST_SCALE) return
			body = {el, x: 0, y: 0, scale: 1, vx: 0, vy: 0, vscale: 0}
			this.bodies.set(el, body)
			// Composited only while in flight: a frame of motion is then a
			// compositor update rather than a repaint, and at rest the tiles hold
			// no GPU memory — hundreds of resident layers on a large high-DPI
			// screen can starve the rest of the page of raster memory.
			el.style.willChange = 'transform'
		}
		body.x += dx
		body.y += dy
		body.scale *= scale
		body.vx = clampVelocity(body.vx)
		body.vy = clampVelocity(body.vy)
		write(body)
		if (!this.frame) {
			this.last = performance.now()
			this.frame = requestAnimationFrame(this.tick)
			this.onActive?.(true)
		}
	}

	stop() {
		cancelAnimationFrame(this.frame)
		this.frame = 0
		for (const body of this.bodies.values()) settle(body)
		this.bodies.clear()
	}

	private tick = (now: number) => {
		const dt = Math.min(MAX_FRAME_S, (now - this.last) / 1000)
		this.last = now
		for (const body of this.bodies.values()) {
			// A body is owned here until it rests: nobody else may drop it, or the
			// element would be left mid-flight. Elements gone from the DOM are let go.
			if (!body.el.isConnected) {
				settle(body)
				this.bodies.delete(body.el)
				continue
			}
			integrate(body, dt)
			if (atRest(body)) {
				settle(body)
				this.bodies.delete(body.el)
			} else {
				write(body)
			}
		}
		if (this.bodies.size > 0) {
			this.frame = requestAnimationFrame(this.tick)
		} else {
			this.frame = 0
			this.onActive?.(false)
		}
	}
}

// Semi-implicit Euler over a damped spring: a = (-k·x - c·v) / m. The scale
// spring uses the same constants on (scale - 1), so size and position of a
// tile follow the same curve and stay coherent in flight.
function integrate(body: Body, dt: number) {
	const {stiffness, damping, mass} = SPRING
	for (let remaining = dt; remaining > 0; remaining -= STEP_S) {
		const h = Math.min(STEP_S, remaining)
		body.vx += ((-stiffness * body.x - damping * body.vx) / mass) * h
		body.x += body.vx * h
		body.vy += ((-stiffness * body.y - damping * body.vy) / mass) * h
		body.y += body.vy * h
		body.vscale += ((-stiffness * (body.scale - 1) - damping * body.vscale) / mass) * h
		body.scale += body.vscale * h
	}
}

function atRest({x, y, scale, vx, vy, vscale}: Body) {
	return (
		Math.abs(x) < REST_DISTANCE &&
		Math.abs(y) < REST_DISTANCE &&
		Math.abs(scale - 1) < REST_SCALE &&
		Math.abs(vx) < REST_VELOCITY &&
		Math.abs(vy) < REST_VELOCITY &&
		Math.abs(vscale) < REST_SCALE * REST_VELOCITY
	)
}

function write({el, x, y, scale}: Body) {
	el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
}

function settle({el}: Body) {
	el.style.transform = ''
	el.style.willChange = ''
}

function clampVelocity(v: number) {
	return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v))
}
