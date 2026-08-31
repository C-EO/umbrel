import {useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject} from 'react'

import {itemsInRect, type Layout} from '@/features/photos/components/listing/timeline-rows'

// A press that moves less than this is a click, and stays one
const DRAG_THRESHOLD_PX = 4
// Dragging past the scroller's top or bottom edge scrolls it: px per frame,
// from the minimum at the edge up to the maximum this far beyond it
const SCROLL_MIN_PX = 4
const SCROLL_MAX_PX = 32
const SCROLL_RAMP_PX = 160

type Drag = {
	pointerId: number
	// Where the press was, in the scroller's content coordinates
	origin: {x: number; y: number}
	// The last pointer position, in client coordinates
	client: {x: number; y: number}
	// Past the threshold: a box is drawn and the selection follows it
	dragging: boolean
	// What the drag adds to (shift/⌘ held): the selection when it started
	base: ReadonlySet<string>
	// The selection last set from the box, to skip redundant updates
	last: ReadonlySet<string>
	scrollFrame: number | null
	// Px per frame the edge auto-scroll currently moves by (signed), updated
	// on every pointer move so the running loop follows the pointer
	scrollBy: number
	// The scroll listener that keeps the box in place, to remove at the end
	onScroll: (() => void) | null
}

// Click-drag selection over the timeline grid, for a mouse. The box is
// drawn in the scroller's content, so it scrolls with the tiles; which tiles
// it touches is arithmetic over the layout (itemsInRect), so it needs no DOM
// measuring and covers rows that aren't mounted. Pressing and moving past
// a small threshold starts a drag — a plain click is left to the tiles —
// and the selection is replaced by what the box covers, or added to with
// shift or ⌘/ctrl held. Dragging beyond the top or bottom edge scrolls.
//
// The scroller gets the handlers; the box element gets `boxRef` and is
// positioned and shown by direct style writes, off React's render path.
export function useMarquee({
	scrollerRef,
	viewRef,
	selectionRef,
	heldRef,
	onSelect,
}: {
	scrollerRef: RefObject<HTMLDivElement | null>
	viewRef: RefObject<{layout: Layout} | null>
	// The current selection, for a drag that adds to it
	selectionRef: RefObject<ReadonlySet<string>>
	// What a plain drag keeps selected, if anything: for a selection that
	// spans views, the part picked elsewhere
	heldRef?: RefObject<ReadonlySet<string>>
	onSelect: (ids: ReadonlySet<string>) => void
}) {
	const boxRef = useRef<HTMLDivElement>(null)
	const dragRef = useRef<Drag | null>(null)
	// The click that ends a drag must not reach the tile under the pointer
	const swallowClick = useRef(false)
	const onSelectRef = useRef(onSelect)
	useEffect(() => {
		onSelectRef.current = onSelect
	}, [onSelect])

	// Position the box and select what it covers, for the drag's current
	// pointer and scroll position
	const update = () => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		const box = boxRef.current
		const layout = viewRef.current?.layout
		if (!drag?.dragging || !scroller || !box || !layout) return
		const bounds = scroller.getBoundingClientRect()
		const x = Math.max(0, Math.min(scroller.clientWidth, drag.client.x - bounds.left))
		const y = Math.max(0, Math.min(scroller.scrollHeight, drag.client.y - bounds.top + scroller.scrollTop))
		const rect = {
			left: Math.min(x, drag.origin.x),
			top: Math.min(y, drag.origin.y),
			right: Math.max(x, drag.origin.x),
			bottom: Math.max(y, drag.origin.y),
		}
		box.style.transform = `translate(${rect.left}px, ${rect.top}px)`
		box.style.width = `${rect.right - rect.left}px`
		box.style.height = `${rect.bottom - rect.top}px`
		const next = new Set(drag.base)
		for (const id of itemsInRect(layout, rect)) next.add(id)
		if (sameSet(next, drag.last)) return
		drag.last = next
		onSelectRef.current(next)
	}

	// Keep scrolling while the pointer is held beyond an edge
	const autoScroll = () => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		if (!drag?.dragging || !scroller) return
		const bounds = scroller.getBoundingClientRect()
		const beyond = drag.client.y < bounds.top ? drag.client.y - bounds.top : Math.max(0, drag.client.y - bounds.bottom)
		if (beyond === 0) {
			if (drag.scrollFrame !== null) cancelAnimationFrame(drag.scrollFrame)
			drag.scrollFrame = null
			return
		}
		const speed = SCROLL_MIN_PX + Math.min(1, Math.abs(beyond) / SCROLL_RAMP_PX) * (SCROLL_MAX_PX - SCROLL_MIN_PX)
		drag.scrollBy = Math.sign(beyond) * speed
		const step = () => {
			scroller.scrollTop += drag.scrollBy
			update()
			drag.scrollFrame = requestAnimationFrame(step)
		}
		if (drag.scrollFrame === null) drag.scrollFrame = requestAnimationFrame(step)
	}

	// Stable, so a zoom gesture can hold on to it
	const end = useCallback(() => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		if (!drag) return
		dragRef.current = null
		if (!drag.dragging) return
		if (drag.scrollFrame !== null) cancelAnimationFrame(drag.scrollFrame)
		if (drag.onScroll) scroller?.removeEventListener('scroll', drag.onScroll)
		if (scroller?.hasPointerCapture(drag.pointerId)) scroller.releasePointerCapture(drag.pointerId)
		if (boxRef.current) boxRef.current.style.display = 'none'
		swallowClick.current = true
	}, [scrollerRef])
	// A drag interrupted by an unmount leaves nothing running
	useEffect(
		() => () => {
			const frame = dragRef.current?.scrollFrame
			if (frame !== null && frame !== undefined) cancelAnimationFrame(frame)
			dragRef.current = null
		},
		[],
	)

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		const scroller = scrollerRef.current
		if (event.button !== 0 || event.pointerType !== 'mouse' || !scroller || dragRef.current) return
		// A fresh press: whatever the last drag left pending is stale
		swallowClick.current = false
		const bounds = scroller.getBoundingClientRect()
		// Not from the scrollbar
		if (event.clientX > bounds.left + scroller.clientWidth) return
		const additive = event.shiftKey || event.metaKey || event.ctrlKey
		dragRef.current = {
			pointerId: event.pointerId,
			origin: {x: event.clientX - bounds.left, y: event.clientY - bounds.top + scroller.scrollTop},
			client: {x: event.clientX, y: event.clientY},
			dragging: false,
			base: additive ? selectionRef.current : (heldRef?.current ?? new Set()),
			last: selectionRef.current,
			scrollFrame: null,
			scrollBy: 0,
			onScroll: null,
		}
	}

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		if (!drag || !scroller || event.pointerId !== drag.pointerId) return
		drag.client = {x: event.clientX, y: event.clientY}
		if (!drag.dragging) {
			const bounds = scroller.getBoundingClientRect()
			const dx = event.clientX - bounds.left - drag.origin.x
			const dy = event.clientY - bounds.top + scroller.scrollTop - drag.origin.y
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
			drag.dragging = true
			// From here the scroller owns the pointer, wherever it goes
			scroller.setPointerCapture(event.pointerId)
			drag.onScroll = update
			scroller.addEventListener('scroll', update)
			if (boxRef.current) boxRef.current.style.display = 'block'
		}
		update()
		autoScroll()
	}

	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (event.pointerId === dragRef.current?.pointerId) end()
	}

	const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
		if (!swallowClick.current) return
		swallowClick.current = false
		event.stopPropagation()
	}

	return {
		boxRef,
		// A zoom gesture ends a drag: the two cannot both own the pointer
		end,
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp,
			// Capture can be taken away (the window loses focus mid-drag): the drag ends with it
			onLostPointerCapture: onPointerUp,
			onClickCapture,
		},
	}
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
	if (a.size !== b.size) return false
	for (const id of a) if (!b.has(id)) return false
	return true
}
