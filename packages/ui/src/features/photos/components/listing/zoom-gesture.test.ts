import {describe, expect, it} from 'vitest'

import {rubberClamp, ZoomGesture, ZoomRate, ZoomSpring} from './zoom-gesture'

// One 60Hz frame
const FRAME = 1 / 60

// Run a gesture to rest, returning every frame it drew
function settle(gesture: ZoomGesture, from = 0) {
	const frames = []
	let now = from
	for (let count = 0; count < 600; count++) {
		now += FRAME * 1000
		const frame = gesture.advance(FRAME, now)
		frames.push(frame)
		if (!frame.live) break
	}
	return frames
}

describe('rubberClamp', () => {
	it('leaves the range alone', () => {
		for (const columns of [2, 5.5, 12, 24]) expect(rubberClamp(columns, 2, 24)).toBe(columns)
	})

	it('resists past either end, symmetrically in log space', () => {
		const under = 2 / rubberClamp(1, 2, 24)
		const over = rubberClamp(48, 2, 24) / 24
		expect(under).toBeCloseTo(over, 6)
		expect(under).toBeGreaterThan(1)
		expect(under).toBeLessThan(1.4)
	})

	it('never gets more than ~1.4× past a limit, however hard it is leaned on', () => {
		expect(rubberClamp(0.0001, 2, 24)).toBeGreaterThan(2 / 1.42)
		expect(rubberClamp(1e6, 2, 24)).toBeLessThan(24 * 1.42)
	})

	it('rounds back onto the limit when the gesture lets go', () => {
		expect(Math.round(Math.min(24, Math.max(2, rubberClamp(1, 2, 24))))).toBe(2)
		expect(Math.round(Math.min(24, Math.max(2, rubberClamp(400, 2, 24))))).toBe(24)
	})
})

describe('ZoomSpring', () => {
	it('reaches rest from a one-column and a forty-column displacement', () => {
		for (const distance of [1, 40]) {
			const spring = new ZoomSpring(10)
			spring.to(10 + distance)
			let frames = 0
			while (spring.advance(FRAME)) if (++frames > 600) break
			expect(frames).toBeLessThan(60)
			expect(spring.value).toBe(10 + distance)
		}
	})

	it('composes when re-aimed in flight instead of restarting', () => {
		const spring = new ZoomSpring(10)
		spring.to(20)
		for (let i = 0; i < 6; i++) spring.advance(FRAME)
		const speed = spring.velocity
		expect(speed).toBeGreaterThan(0)
		spring.to(30)
		// The motion carries on: it does not stop and start again
		expect(spring.velocity).toBe(speed)
		spring.advance(FRAME)
		expect(spring.velocity).toBeGreaterThan(speed * 0.5)
		while (spring.advance(FRAME));
		expect(spring.value).toBe(30)
	})
})

describe('ZoomRate', () => {
	it('is racing across a flick and calm across a deliberate pinch', () => {
		const flick = new ZoomRate()
		// A 400px tile to a 14px one: 3 columns to 80 in half a second
		for (let frame = 0; frame <= 30; frame++) flick.sample(3 + (77 * frame) / 30, frame * 16.7)
		expect(flick.racing).toBe(true)

		const slow = new ZoomRate()
		// The same distance over eight seconds
		for (let frame = 0; frame <= 480; frame++) slow.sample(3 + (77 * frame) / 480, frame * 16.7)
		expect(slow.racing).toBe(false)
	})

	it('forgets a flick once the zoom has been still for the window', () => {
		const rate = new ZoomRate()
		rate.sample(24, 0)
		rate.sample(80, 50)
		expect(rate.racing).toBe(true)
		rate.sample(80, 200)
		expect(rate.racing).toBe(false)
	})
})

describe('ZoomGesture', () => {
	const gesture = () => {
		const zoom = new ZoomGesture()
		zoom.range = {min: 3, max: 24}
		zoom.adopt(6)
		return zoom
	}

	it('maps a pinch factor onto the column count it began at', () => {
		const zoom = gesture()
		zoom.begin({x: 100, y: 200})
		zoom.scale(2)
		expect(zoom.columns).toBe(3)
		zoom.scale(0.5)
		expect(zoom.columns).toBe(12)
		// … and always about where it began, not about the last frame
		zoom.scale(1)
		expect(zoom.columns).toBe(6)
	})

	it('carries the focal point and the pan through the gesture', () => {
		const zoom = gesture()
		zoom.begin({x: 100, y: 200})
		zoom.scale(1.5, {x: 4, y: -30})
		const [frame] = settle(zoom)
		expect(frame!.focal).toEqual({x: 100, y: 200})
		expect(frame!.pan).toEqual({x: 4, y: -30})
	})

	it('settles on the nearest whole count, undoing any rubber band', () => {
		const zoom = gesture()
		zoom.begin(null)
		zoom.scale(0.4) // 15 columns
		zoom.release(true)
		const frames = settle(zoom)
		expect(frames.at(-1)!.live).toBe(false)
		expect(zoom.columns).toBe(15)

		const leaning = gesture()
		leaning.begin(null)
		leaning.scale(0.05) // way past the far end
		expect(leaning.columns).toBeGreaterThan(24)
		leaning.release(true)
		settle(leaning)
		expect(leaning.columns).toBe(24)
	})

	it('commits at once with reduced motion, and draws no spring frames', () => {
		const zoom = gesture()
		zoom.begin(null)
		zoom.scale(0.45)
		zoom.release(false)
		expect(zoom.columns).toBe(13)
		expect(zoom.live).toBe(false)
		expect(settle(zoom)).toHaveLength(1)
	})

	it('takes a new gesture over a settle without restarting the zoom', () => {
		const zoom = gesture()
		zoom.begin(null)
		zoom.scale(0.32) // 18.75 columns, which settles to 19
		zoom.release(true)
		zoom.advance(FRAME, 16)
		zoom.advance(FRAME, 32)
		const midFlight = zoom.columns
		expect(midFlight).not.toBe(19)
		zoom.begin(null)
		zoom.scale(1)
		// The new gesture starts from where the settle had got to
		expect(zoom.columns).toBeCloseTo(midFlight, 6)
	})

	it('is racing while a flick is under way and calm once it settles', () => {
		const zoom = gesture()
		zoom.begin(null)
		let now = 0
		const racing: boolean[] = []
		for (let frame = 1; frame <= 20; frame++) {
			// 6 columns out to 24, in a third of a second
			zoom.scale(6 / (6 + frame * 0.9))
			now += FRAME * 1000
			racing.push(zoom.advance(FRAME, now).racing)
		}
		expect(racing.filter(Boolean).length).toBeGreaterThan(15)
		zoom.release(true)
		expect(settle(zoom, now).at(-1)!.racing).toBe(false)
	})
})
