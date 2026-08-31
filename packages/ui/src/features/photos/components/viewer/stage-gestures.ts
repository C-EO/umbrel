import {useReducedMotion} from 'motion/react'
import {useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react'

import {EASE_OUT} from '@/features/photos/components/viewer/picture-flight'

// Sensitivity. Movement in px before the gesture picks its axis; the travel
// or the flick (px/ms) that commits a step or the dismissal; and how much of
// the finger's pull the picture follows where there is nothing to pull to.
const LOCK = 10
const STEP_TRAVEL = 72
const STEP_FLICK = 0.5
const DISMISS_TRAVEL = 120
const DISMISS_FLICK = 0.5
const OVERDRAG = 0.3
// How the picture recedes as it is pulled down — fully shrunk after 700px —
// and how quickly the backdrop clears to the timeline behind it (never fully:
// the picture still needs a floor to read against while the finger holds it)
const SHRINK = 1 / 1400
const SHRINK_FLOOR = 0.5
const CLEAR = 1 / 520
// The dark between panes as they slide with the finger — the neighbours ride
// one stage-width plus this to each side (the item viewer lays them out there)
export const PANE_GAP = 24
const SETTLE = {duration: 250, easing: EASE_OUT} as const
// The commit's slide: the finger's pane carries on out as the neighbour's
// comes to rest at the centre. Held at its end (`fill`) until the id has
// actually swapped, so nothing flashes back between the two.
const STEP_SETTLE = {duration: 260, easing: EASE_OUT, fill: 'forwards'} as const
// The strip of a video the browser draws its controls in: a drag from there
// is a scrub, not a gesture
const VIDEO_CONTROLS_PX = 72

type Drag = {
	pointerId: number
	surface: HTMLElement
	x0: number
	y0: number
	axis: 'step' | 'dismiss' | 'dead' | null
	// The picture's box when the axis locked, for shrinking about its centre
	// (its transform-origin is its corner, which the flight's math needs)
	w: number
	h: number
	// The stage's width when the axis locked: one pane of the strip, the
	// distance a committed step slides
	pane: number
	dx: number
	dy: number
	vx: number
	vy: number
	t: number
}

// Touch on the lightbox's stage: a horizontal drag slides the strip — the
// picture tracks the finger with its neighbours riding one pane to each side
// (the viewer mounts them while `stepping`), and past a threshold or a flick
// the strip carries on until the neighbour rests at the centre — and a
// downward drag dismisses, the picture shrinking under the finger while the
// backdrop clears to the timeline behind it. Release short of either
// threshold and everything springs back. Direct manipulation runs even under
// reduced motion (it is tracking, not motion); only the settles are snapped.
// The elements are driven through their inline transforms, off React's
// render path; committing the dismissal clears the picture's and hands the
// final transform to `onDismiss`, for the flight to carry on from the finger
// (picture-flight's `back(from)`).
export function useStageGestures({
	open,
	enabled,
	pictureRef,
	peekRefs,
	shownId,
	canStep,
	onStep,
	onDismissStart,
	onDismiss,
}: {
	// The lightbox session: a new one starts with the chrome back in place
	open: boolean
	enabled: boolean
	pictureRef: RefObject<HTMLElement | null>
	// The neighbours' panes, mounted by the viewer while `stepping` — they
	// follow the finger with the picture and are gone once the strip rests
	peekRefs: {prev: RefObject<HTMLElement | null>; next: RefObject<HTMLElement | null>}
	// The item on stage — a committed step's held end frames release the
	// moment this changes (see the layout effect below)
	shownId: string | undefined
	canStep: (dir: 1 | -1) => boolean
	onStep: (dir: 1 | -1) => void
	// The dismissal locked: the timeline behind can get ready to be seen
	onDismissStart: () => void
	// … and committed, at `from` (the picture's transform, just cleared)
	onDismiss: (from: string) => void
}) {
	const reduceMotion = useReducedMotion() ?? false
	const dragRef = useRef<Drag | null>(null)
	const backdropRef = useRef<HTMLDivElement | null>(null)
	// While a dismissal is being dragged the chrome steps aside (a state, not
	// a per-frame style: it is a fade the moment the axis locks). It stays
	// aside once the dismissal commits — the close must not flash it back —
	// and returns only when the drag settles back, or for the next session.
	const [dismissing, setDismissing] = useState(false)
	// While a step is being dragged (and until its settle rests) the
	// neighbours' panes are on stage
	const [stepping, setStepping] = useState(false)
	useEffect(() => {
		if (open) {
			setDismissing(false)
			setStepping(false)
		}
	}, [open])

	// The strip: the picture and whichever neighbours are mounted
	const strip = () =>
		[pictureRef.current, peekRefs.prev.current, peekRefs.next.current].filter(Boolean) as HTMLElement[]

	// A committed step's slide animations, still holding their end frames (the
	// neighbour at the centre, the old picture out of view) while React swaps
	// the id. They release here — a layout effect in the very commit the new
	// picture first renders in, before anything paints — so there is never a
	// frame with the old picture back at the centre.
	const pendingRef = useRef<Animation[] | null>(null)
	useLayoutEffect(() => {
		if (!pendingRef.current) return
		for (const animation of pendingRef.current) animation.cancel()
		pendingRef.current = null
		for (const element of strip()) element.style.transform = ''
		setStepping(false)
	}, [shownId])

	const settleBack = (elements: HTMLElement[]) => {
		let settle: Animation | undefined
		for (const element of elements) {
			const from = element.style.transform
			element.style.transform = ''
			if (from && !reduceMotion) settle = element.animate([{transform: from}, {transform: 'none'}], SETTLE)
		}
		return settle
	}

	const restoreBackdrop = () => {
		const backdrop = backdropRef.current
		if (!backdrop || backdrop.style.opacity === '') return
		const from = backdrop.style.opacity
		backdrop.style.opacity = ''
		if (!reduceMotion) backdrop.animate([{opacity: from}, {opacity: 1}], SETTLE)
	}

	// The strip slides on: the finger's pane carries out of view as the
	// neighbour's comes to rest at the centre, and only then does the id swap —
	// the new current mounts on the very thumbnail the pane was showing, so
	// nothing appears or jumps at the hand-over.
	const step = async (drag: Drag, dir: 1 | -1) => {
		const elements = strip()
		if (reduceMotion) {
			for (const element of elements) element.style.transform = ''
			setStepping(false)
			onStep(dir)
			return
		}
		const to = `translateX(${-dir * (drag.pane + PANE_GAP)}px)`
		const slides = elements.map((element) => {
			const from = element.style.transform
			element.style.transform = ''
			return element.animate([{transform: from || 'none'}, {transform: to}], STEP_SETTLE)
		})
		await Promise.all(slides.map((slide) => slide.finished.catch(() => {})))
		if (!pictureRef.current?.isConnected) return
		// The end frames stay held (fill) across the id swap — React's commit
		// may be a paint or two away, and cancelling here would flash the old
		// picture back at the centre. The shownId layout effect releases them.
		pendingRef.current = slides
		onStep(dir)
	}

	const release = (event: React.PointerEvent, cancelled: boolean) => {
		const drag = dragRef.current
		if (!drag || event.pointerId !== drag.pointerId) return
		dragRef.current = null
		const picture = pictureRef.current
		// A close begun under the drag (another finger on ✕) owns the picture now
		if (!enabled || !picture || !drag.axis || drag.axis === 'dead') return
		if (drag.axis === 'step') {
			const dir: 1 | -1 = drag.dx < 0 ? 1 : -1
			const flick = Math.sign(drag.vx) === Math.sign(drag.dx) && Math.abs(drag.vx) > STEP_FLICK
			if (!cancelled && canStep(dir) && (Math.abs(drag.dx) > STEP_TRAVEL || flick)) {
				void step(drag, dir)
			} else {
				// The panes stay up for the ride back, and leave once it rests
				const settle = settleBack(strip())
				if (settle) settle.finished.catch(() => {}).then(() => setStepping(false))
				else setStepping(false)
			}
			return
		}
		if (!cancelled && (drag.dy > DISMISS_TRAVEL || drag.vy > DISMISS_FLICK)) {
			const from = picture.style.transform
			picture.style.transform = ''
			// The backdrop keeps the opacity the drag left it at; the close
			// animation fades it the rest of the way
			onDismiss(from)
		} else {
			setDismissing(false)
			settleBack([picture])
			restoreBackdrop()
		}
	}

	const handlers = {
		onPointerDown: (event: React.PointerEvent) => {
			if (!enabled || event.pointerType !== 'touch' || !event.isPrimary || dragRef.current) return
			// A drag from a video's control strip is the browser's (scrubbing);
			// the rest of the video is stage like any other
			const video = (event.target as Element).closest?.('video')
			if (video && event.clientY > video.getBoundingClientRect().bottom - VIDEO_CONTROLS_PX) return
			dragRef.current = {
				pointerId: event.pointerId,
				surface: event.currentTarget as HTMLElement,
				x0: event.clientX,
				y0: event.clientY,
				axis: null,
				w: 0,
				h: 0,
				pane: 0,
				dx: 0,
				dy: 0,
				vx: 0,
				vy: 0,
				t: event.timeStamp,
			}
		},
		onPointerMove: (event: React.PointerEvent) => {
			const drag = dragRef.current
			const picture = pictureRef.current
			if (!drag || !picture || event.pointerId !== drag.pointerId || drag.axis === 'dead') return
			if (!enabled) {
				dragRef.current = null
				return
			}
			const dx = event.clientX - drag.x0
			const dy = event.clientY - drag.y0
			if (drag.axis === null) {
				if (Math.hypot(dx, dy) < LOCK) return
				drag.axis = Math.abs(dx) > Math.abs(dy) ? 'step' : dy > 0 ? 'dismiss' : 'dead'
				if (drag.axis === 'dead') return
				// A settle still in flight yields to the finger; so does a commit
				// whose id swap hasn't landed yet
				pendingRef.current = null
				for (const element of strip()) for (const animation of element.getAnimations()) animation.cancel()
				const rect = picture.getBoundingClientRect()
				drag.w = rect.width
				drag.h = rect.height
				drag.pane = drag.surface.clientWidth
				drag.surface.setPointerCapture(drag.pointerId)
				if (drag.axis === 'dismiss') {
					setDismissing(true)
					onDismissStart()
				} else setStepping(true)
			}
			const dt = event.timeStamp - drag.t
			if (dt > 0) {
				drag.vx = 0.8 * ((dx - drag.dx) / dt) + 0.2 * drag.vx
				drag.vy = 0.8 * ((dy - drag.dy) / dt) + 0.2 * drag.vy
				drag.t = event.timeStamp
			}
			drag.dx = dx
			drag.dy = dy
			if (drag.axis === 'step') {
				// The whole strip follows: the picture and the panes to its sides
				const toward = canStep(dx < 0 ? 1 : -1)
				const shift = `translateX(${toward ? dx : dx * OVERDRAG}px)`
				for (const element of strip()) element.style.transform = shift
				return
			}
			// Dismiss: follow the finger, shrinking about the centre as it goes
			// down (upward it only stretches), the backdrop clearing with it
			const k = dy > 0 ? Math.max(1 - dy * SHRINK, SHRINK_FLOOR) : 1
			const tx = dx + (drag.w / 2) * (1 - k)
			const ty = (dy > 0 ? dy : dy * OVERDRAG) + (drag.h / 2) * (1 - k)
			picture.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`
			const backdrop = backdropRef.current
			if (backdrop) backdrop.style.opacity = String(1 - Math.min(Math.max(dy, 0) * CLEAR, 0.9))
		},
		onPointerUp: (event: React.PointerEvent) => release(event, false),
		onPointerCancel: (event: React.PointerEvent) => release(event, true),
	}

	return {handlers, backdropRef, dismissing, stepping}
}
