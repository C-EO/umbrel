import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {flushSync} from 'react-dom'

import {AppCard} from '@/features/app-store/components/app-card'
import {appGridClass, storeRevealCardClass, storeRevealDelay} from '@/features/app-store/constants'
import type {AppStoreStatus} from '@/features/app-store/data/catalog'
import {
	buildGridLayout,
	countGridColumns,
	EMPTY_RANGE,
	rowTop,
	sameRange,
	visibleRowRange,
	type RowRange,
} from '@/features/app-store/data/virtual-grid'
import {useAppCardStateMap} from '@/features/app-store/hooks/use-app-status'
import {cn} from '@/lib/utils'
import {useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import type {AppStateOrLoading, RegistryApp} from '@/trpc/trpc'

// Rendered beyond the viewport on each side. Scrolling is composited — the
// page can move before the main thread has heard about it — and this is the
// slack that keeps a fast fling from outrunning the mounted rows.
const OVERSCAN_PX = 600
// Cards mounted this soon after the grid are part of the page's entrance and
// reveal with it; anything mounted later arrived by scrolling and just appears
const REVEAL_WINDOW_MS = 150
// Per-card stagger and its cap, matching AppGrid
const REVEAL_STAGGER_MS = 12
const REVEAL_STAGGER_MAX_MS = 240
// Long enough to wrap onto the card's second (and last) tagline line
const PROBE_TAGLINE =
	'A tagline long enough to wrap onto a second line so the probe measures the tallest a card can be on any width'

type Geometry = {columns: number; rowHeight: number; gap: number}

// The last geometry any grid measured. A grid's very first render happens
// before it can measure, and the sheet restores a page's scroll position right
// after that render — so the initial height must already be right or the
// restore gets clamped. Within a session the geometry only changes with the
// viewport, so the previous grid's answer is the best available guess.
let lastGeometry: Geometry = {columns: 1, rowHeight: 76, gap: 6}

// The mounted rows, and the first of them actually inside the viewport (the
// ones before it are overscan) — where the entrance stagger counts from
type View = RowRange & {visibleStart: number}
const EMPTY_VIEW: View = {...EMPTY_RANGE, visibleStart: 0}

/**
 * The catalog grid, virtualized against the sheet's scroller. Same cards and
 * the same column CSS as `AppGrid`, but only the rows within the viewport and
 * a margin around it are mounted; the rest is arithmetic over a fixed-height
 * box, so the complete catalog costs the same to mount and scroll as a short
 * list.
 *
 * The grid lives in the page flow below other content (editorial sections,
 * headings, featured cards), so it cannot own its scrolling: it measures where
 * it sits inside the sheet's scroll element and which rows that element's
 * viewport covers. Row geometry comes from a hidden probe row laid out by the
 * exact CSS the real rows use — however the card or the breakpoints change,
 * the arithmetic follows. Scroll updates are flushed synchronously so a new
 * row is in the DOM before the frame that shows it paints, which also makes
 * programmatic jumps (scroll restoration on the way back from an app page)
 * land on rendered rows.
 */
export function VirtualAppGrid({
	apps,
	statuses,
	className,
	revealDelayStart,
}: {
	apps: readonly RegistryApp[]
	statuses?: Map<string, AppStoreStatus>
	className?: string
	/** When set, the cards mounting with the page trickle in with a tiny stagger from this delay */
	revealDelayStart?: number
}) {
	const {scrollElement} = useSheetStickyHeader()
	const containerRef = useRef<HTMLDivElement>(null)
	const probeRef = useRef<HTMLDivElement>(null)
	const appStates = useAppCardStateMap(apps)

	const [geometry, setGeometry] = useState(() => lastGeometry)
	const layout = useMemo(() => buildGridLayout({count: apps.length, ...geometry}), [apps.length, geometry])
	// Nothing is mounted until the grid has been placed within the scroller,
	// which happens below, before first paint
	const [view, setView] = useState(EMPTY_VIEW)

	// Whether cards mounting now are part of the page's entrance
	const [revealing, setRevealing] = useState(true)
	useEffect(() => {
		const timer = setTimeout(() => setRevealing(false), REVEAL_WINDOW_MS)
		return () => clearTimeout(timer)
	}, [])

	// Placement and listeners, redone whenever the layout changes (more or
	// fewer apps, a new geometry) so the view is right before paint
	useLayoutEffect(() => {
		const scroller = scrollElement
		const container = containerRef.current
		const probe = probeRef.current
		if (!scroller || !container || !probe) return
		let offset = 0
		let current: View | null = null

		// The rows the scroller's viewport (plus overscan) covers right now
		const sync = () => {
			const metrics = {offset, scrollTop: scroller.scrollTop, viewport: scroller.clientHeight}
			const next = {
				...visibleRowRange(layout, {...metrics, overscan: OVERSCAN_PX}),
				visibleStart: visibleRowRange(layout, {...metrics, overscan: 0}).start,
			}
			if (current && sameRange(current, next) && current.visibleStart === next.visibleStart) return
			current = next
			setView(next)
		}
		// The probe's geometry and the grid's position within the scroller
		const measure = () => {
			const rowHeight = probe.offsetHeight
			// No height means the probe isn't laid out (a hidden ancestor, e.g.
			// while a lazy route suspends): nothing to measure yet
			if (rowHeight === 0) return
			const style = getComputedStyle(probe)
			const next = {columns: countGridColumns(style.gridTemplateColumns), rowHeight, gap: parseFloat(style.rowGap) || 0}
			lastGeometry = next
			setGeometry((g) =>
				g.columns === next.columns && g.rowHeight === next.rowHeight && g.gap === next.gap ? g : next,
			)
			offset = offsetTopWithin(container, scroller)
			sync()
		}

		measure()
		// Synchronous, so the rows a scroll reveals are in the DOM before that
		// frame paints — a plain state update would land one frame later
		const onScroll = () => flushSync(sync)
		scroller.addEventListener('scroll', onScroll, {passive: true})
		const observer = new ResizeObserver(measure)
		// Width → columns, height → row height
		observer.observe(probe)
		// Viewport height
		observer.observe(scroller)
		// Anything above the grid changing height moves the grid within the scroller
		if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
		return () => {
			scroller.removeEventListener('scroll', onScroll)
			observer.disconnect()
		}
	}, [scrollElement, layout])

	const first = apps[0]
	const probeApp = useMemo(() => first && {...first, tagline: PROBE_TAGLINE}, [first])

	// The view may briefly outlive a layout that shrank under it (fewer
	// search results); the effect above re-syncs it before paint
	const rows: number[] = []
	for (let row = view.start; row <= Math.min(view.end, layout.rows - 1); row++) rows.push(row)

	return (
		<div ref={containerRef} className={cn('relative', className)} style={{height: layout.total}}>
			{/* The probe: one real card, action button and all, in a row styled
			    exactly like the rows below. visibility:hidden keeps it out of
			    paint, hit-testing, the focus order and the accessibility tree
			    while it is still laid out. */}
			{probeApp && (
				<div ref={probeRef} className={cn(appGridClass, 'invisible absolute inset-x-0 top-0')}>
					<AppCard app={probeApp} status='available' />
				</div>
			)}
			{rows.map((row) => (
				<div key={row} className={cn(appGridClass, 'absolute inset-x-0')} style={{top: rowTop(layout, row)}}>
					{apps.slice(row * layout.columns, (row + 1) * layout.columns).map((app, column) => {
						const state = appStates.get(app.id)
						// Overscan rows above the viewport are already in place; the
						// trickle starts with the first visible row
						const order = Math.max(0, row - view.visibleStart) * layout.columns + column
						const revealDelay =
							revealing && revealDelayStart !== undefined
								? revealDelayStart + Math.min(order * REVEAL_STAGGER_MS, REVEAL_STAGGER_MAX_MS)
								: undefined
						return (
							<GridCard
								key={app.id}
								app={app}
								status={statuses?.get(app.id)}
								lifecycleState={state?.state}
								progress={state?.progress}
								revealDelay={revealDelay}
							/>
						)
					})}
				</div>
			))}
		</div>
	)
}

// Card props are primitives (plus the registry's stable app object), so a
// scroll that mounts one new row leaves every other card untouched
const GridCard = memo(function GridCard({
	app,
	status,
	lifecycleState,
	progress,
	revealDelay,
}: {
	app: RegistryApp
	status?: AppStoreStatus
	lifecycleState?: AppStateOrLoading
	progress?: number
	revealDelay?: number
}) {
	// Decided once, at mount: a card that entered with the page keeps its place
	// in the stagger; one that arrived by scrolling never starts animating later
	const [reveal] = useState(revealDelay)
	return (
		<AppCard
			app={app}
			status={status}
			lifecycleState={lifecycleState}
			progress={progress}
			className={reveal === undefined ? undefined : storeRevealCardClass}
			style={reveal === undefined ? undefined : storeRevealDelay(reveal)}
		/>
	)
})

// Where `el` starts within `scroller`'s scrollable content, from layout
// positions (offsetTop) rather than client rects: rects are scaled by the
// sheet's zoom-in animation on open, layout values are not, and nothing would
// re-measure once the animation ends. Both chains run up to the same root, so
// the scroller needn't be an offsetParent of the grid.
function offsetTopWithin(el: HTMLElement, scroller: HTMLElement): number {
	return pageOffsetTop(el) - pageOffsetTop(scroller)
}

function pageOffsetTop(el: HTMLElement): number {
	let top = 0
	for (let node: Element | null = el; node instanceof HTMLElement; node = node.offsetParent) top += node.offsetTop
	return top
}
