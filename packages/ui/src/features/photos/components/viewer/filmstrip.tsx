import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'

import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import type {Item} from '@/features/photos/hooks/use-items'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'

// Thumb box and the pitch between thumbs. Layout never changes on hover: the
// growth is a transform, so slot positions stay arithmetic and the strip can
// be windowed like the timeline.
const THUMB = 48
const GAP = 8
const SLOT = THUMB + GAP
const GROW = 1.5
// How far neighbours slide to keep the gap while a thumb is grown
const SHIFT = (THUMB * (GROW - 1)) / 2
// Thumbs mounted beyond each edge of the strip
const OVERSCAN = 8
// Ask for the next page when this close to the end of what's loaded
const LOAD_AHEAD = 30

// How long the strip must be quiet after a user scroll before it is theirs
// no longer — the nearest slot is eased onto and id changes may centre again
const SCRUB_IDLE_MS = 160

// A horizontally virtualized strip of thumbnails. On hover the pointed-at
// thumb grows and everything to either side slides over by half the growth,
// so gaps stay even — one index of React state and a CSS transition per thumb,
// nothing per frame. Scrolling the strip is also scrubbing (iOS-style): the
// thumb passing the centre becomes the item on stage — cheap, because the
// stage runs on thumbnails until the scrub rests (the viewer's rest gate).
export function Filmstrip({
	items,
	currentId,
	hasMore,
	loadMore,
	onSelect,
	grow = true,
}: {
	items: Item[]
	currentId: string
	hasMore: boolean
	loadMore: () => void
	onSelect: (id: string) => void
	// Hover growth (desktop only); off = a plain strip
	grow?: boolean
}) {
	const isMobile = useIsMobile()
	const containerRef = useRef<HTMLDivElement>(null)
	const {width} = useContainerSize(containerRef)
	const [range, setRange] = useState({start: 0, end: -1})
	const [hovered, setHovered] = useState<number | null>(null)
	const growEnabled = grow && !isMobile

	// Padding so the first and last thumbs can sit at the centre
	const pad = Math.max(0, (width - THUMB) / 2)
	const currentIndex = items.findIndex((item) => item.id === currentId)

	const updateRange = useCallback(() => {
		const el = containerRef.current
		if (!el || width === 0) return
		const left = el.scrollLeft
		const start = Math.max(0, Math.floor((left - pad) / SLOT) - OVERSCAN)
		const end = Math.min(items.length - 1, Math.ceil((left - pad + width) / SLOT) + OVERSCAN)
		setRange((prev) => (prev.start === start && prev.end === end ? prev : {start, end}))
	}, [items.length, pad, width])
	useLayoutEffect(updateRange, [updateRange])

	useEffect(() => {
		if (hasMore && range.end >= items.length - 1 - LOAD_AHEAD) loadMore()
	}, [hasMore, range.end, items.length, loadMore])

	// Who owns the strip's scroll position. `settling` is a scroll of our own
	// (centring a thumb), carrying its destination so its events select
	// nothing and the flag can clear when it gets there. `scrubbing` is the
	// user's — a drag, its momentum, a wheel — during which id changes must
	// not centre (the finger owns the position); it ends once the strip has
	// been quiet for a beat, easing onto the nearest slot.
	const settling = useRef<{target: number} | null>(null)
	const scrubbing = useRef(false)
	const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const selectFrame = useRef(0)
	useEffect(
		() => () => {
			clearTimeout(idleTimer.current)
			cancelAnimationFrame(selectFrame.current)
		},
		[],
	)

	const centerOn = useCallback((index: number, behavior: ScrollBehavior) => {
		const el = containerRef.current
		if (!el) return
		// Clamped, or an end-of-strip target could never be reached and the
		// settle would never end
		const target = Math.max(0, Math.min(index * SLOT, el.scrollWidth - el.clientWidth))
		settling.current = {target}
		el.scrollTo({left: target, behavior})
		if (Math.abs(el.scrollLeft - target) < 1) settling.current = null
	}, [])

	// Keep the current thumb centred: instantly on first layout, smoothly
	// after — unless the user is scrubbing, in which case the id is following
	// the strip, not the other way round
	const settledRef = useRef(false)
	// The (id, index) pair the strip last laid out for, to tell a navigation
	// (new id) from the library shifting under a stationary item (same id,
	// new index) — photos landing from an upload ahead of this one
	const anchorRef = useRef<{id: string; index: number} | null>(null)
	useLayoutEffect(() => {
		const el = containerRef.current
		if (!el || width === 0 || currentIndex < 0) return
		const anchor = anchorRef.current
		anchorRef.current = {id: currentId, index: currentIndex}
		if (settledRef.current && anchor?.id === currentId) {
			const delta = currentIndex - anchor.index
			if (delta === 0) return
			// Same item, new slot: the list changed around it, not a navigation.
			// Every thumb just moved by the same distance, so move the viewport
			// with them — before paint, and no matter who owns the scroll — and
			// the strip stands perfectly still. Scroll anchoring, by hand: the
			// browser's can't see absolutely-positioned thumbs move.
			el.scrollLeft += delta * SLOT
			if (settling.current)
				centerOn(currentIndex, 'smooth') // re-aim a settle mid-flight
			else if (!scrubbing.current) settling.current = {target: el.scrollLeft} // the echo isn't a scrub
			// The pointer hasn't moved, so neither may the grown thumb
			setHovered((h) => (h === null ? null : h + delta))
			updateRange()
			return
		}
		if (scrubbing.current) return
		centerOn(currentIndex, settledRef.current ? 'smooth' : 'instant')
		settledRef.current = true
	}, [currentId, currentIndex, width, centerOn, updateRange])

	const onScroll = () => {
		updateRange()
		const el = containerRef.current
		if (!el) return
		if (settling.current) {
			if (Math.abs(el.scrollLeft - settling.current.target) < 1) settling.current = null
			return
		}
		// The user's scroll: the slot at the centre becomes the item on stage
		scrubbing.current = true
		cancelAnimationFrame(selectFrame.current)
		selectFrame.current = requestAnimationFrame(() => {
			const index = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / SLOT)))
			const id = items[index]?.id
			if (id && id !== currentId) onSelect(id)
		})
		clearTimeout(idleTimer.current)
		idleTimer.current = setTimeout(() => {
			scrubbing.current = false
			// Rest between slots reads as nowhere: ease onto the nearest one
			centerOn(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / SLOT))), 'smooth')
		}, SCRUB_IDLE_MS)
	}

	// Any touch or wheel takes the strip from a settle mid-flight
	const takeOver = () => {
		settling.current = null
	}

	// A click is a destination, not a scrub: hand the strip back so the
	// centring effect carries it to the chosen thumb, not the nearest slot
	const select = (id: string) => {
		scrubbing.current = false
		clearTimeout(idleTimer.current)
		onSelect(id)
	}

	// Mouse wheels are vertical; the strip is not. React's wheel listener is
	// passive, so this one is attached by hand to be able to claim the event.
	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		const onWheel = (e: WheelEvent) => {
			settling.current = null
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
			e.preventDefault()
			el.scrollLeft += e.deltaY
		}
		el.addEventListener('wheel', onWheel, {passive: false})
		return () => el.removeEventListener('wheel', onWheel)
	}, [])

	return (
		<div
			ref={containerRef}
			onScroll={onScroll}
			onPointerDown={takeOver}
			onPointerLeave={() => setHovered(null)}
			// 48px thumb + 8px bottom inset + 24px growth headroom + 8px so the ring clears the clip edge.
			// The headroom overlaps the lightbox stage (the viewer pulls the footer up over it), where
			// it would swallow clicks on a video's seek bar — so the box is transparent to hits, and
			// only the visible band below re-enables them (scrolls and wheels on it bubble to this box)
			className='umbrel-hide-scrollbar pointer-events-none relative h-[88px] w-full overflow-x-auto overflow-y-hidden overscroll-x-contain'
		>
			<div className='relative h-full' style={{width: items.length * SLOT - GAP + pad * 2}}>
				<div className='pointer-events-auto absolute bottom-0 h-14 w-full' />
				{items.slice(range.start, range.end + 1).map((item, i) => {
					const index = range.start + i
					// Neighbours make room: left ones slide left, right ones slide right
					const shift = hovered === null ? 0 : index < hovered ? -SHIFT : index > hovered ? SHIFT : 0
					return (
						<Thumb
							key={item.id}
							item={item}
							left={pad + index * SLOT}
							current={item.id === currentId}
							scale={hovered === index ? GROW : 1}
							shift={shift}
							onHover={growEnabled ? () => setHovered(index) : undefined}
							onSelect={select}
						/>
					)
				})}
			</div>
		</div>
	)
}

const Thumb = memo(function Thumb({
	item,
	left,
	current,
	scale,
	shift,
	onHover,
	onSelect,
}: {
	item: Item
	left: number
	current: boolean
	scale: number
	shift: number
	onHover?: () => void
	onSelect: (id: string) => void
}) {
	return (
		<button
			type='button'
			onClick={() => onSelect(item.id)}
			onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.()}
			aria-label={item.kind}
			aria-current={current ? 'true' : undefined}
			style={{
				left,
				width: THUMB,
				height: THUMB,
				transform: `translateX(${shift}px) scale(${scale})`,
				transformOrigin: 'bottom center',
				zIndex: scale > 1 ? 2 : 1,
			}}
			className={cn(
				'pointer-events-auto absolute bottom-2 overflow-hidden rounded-md ring-white outline-hidden transition-[transform,box-shadow,opacity] duration-200 ease-out focus-visible:ring-2',
				current ? 'opacity-100 ring-2' : 'opacity-75 hover:opacity-100',
			)}
		>
			{/* The strip's thumbs are 48px boxes: the 192 rendition is plenty */}
			<ItemThumbnail item={item} size={192} className='h-full w-full' />
		</button>
	)
})
