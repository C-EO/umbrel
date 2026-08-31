import {useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref} from 'react'

import type {AtlasPlan} from '@/features/photos/components/listing/gpu/capability'
import {ThumbnailSource} from '@/features/photos/components/listing/gpu/thumbnail-source'
import {createRenderer, type Frame, type TileRenderer} from '@/features/photos/components/listing/gpu/tile-renderer'
import {itemAt} from '@/features/photos/components/listing/timeline-rows'
import {itemThumbnailUrl} from '@/features/photos/hooks/use-items'
import {useHttpUrlAuthorizer} from '@/modules/auth/http-url-authorizer'

// The canvas the grid draws its tiles on below the seam, and everything that
// keeps it fed.
//
// It owns exactly one WebGL2 context — created when the grid first goes below
// the tile size elements can carry and released when it comes back up, so the
// lightbox and the filmstrip never find themselves competing for one. The
// canvas is a child of the scroller's content, so ordinary scrolling moves it
// on the compositor and nothing here runs; drawing happens when the grid says
// so, and once more per frame while a photograph is still fading in.
//
// Nothing renders here. React mounts the element and this fills it.
export type TileCanvasHandle = {
	// Draw a frame, and keep drawing while anything in it is still fading in.
	// `racing` is the zoom moving too fast to be worth fetching pixels for.
	draw: (frame: Frame, racing: boolean) => void
}

export function TileCanvas({
	ref,
	plan,
	cell,
	onLost,
}: {
	ref: Ref<TileCanvasHandle>
	plan: AtlasPlan
	// The cell size the current tile wants, read once: the renderer moves to
	// another itself when the zoom settles somewhere new
	cell: number
	// The context died. The grid springs back to a tile size elements can
	// draw, so nobody is ever stranded looking at a blank page.
	onLost: () => void
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	// One shared token for every URL the canvas asks for: a query observer per
	// tile was once most of what a dense zoom stop cost
	const authorize = useHttpUrlAuthorizer()
	const [initialCell] = useState(cell)
	const engine = useRef<{renderer: TileRenderer; source: ThumbnailSource} | null>(null)
	// Read by the callbacks below, which are made once
	const latest = useRef({authorize, onLost})
	useLayoutEffect(() => {
		latest.current = {authorize, onLost}
	})
	// The last frame drawn, so an arriving photograph can be shown without the
	// grid being asked for one
	const shown = useRef<Frame | null>(null)
	const scheduled = useRef(0)

	const again = () => {
		if (scheduled.current) return
		scheduled.current = requestAnimationFrame(() => {
			scheduled.current = 0
			const frame = shown.current
			if (frame && engine.current?.renderer.draw(frame)) again()
		})
	}

	useLayoutEffect(() => {
		// The canvas is made here rather than rendered, because releasing a
		// context poisons the element it came from: React would hand the next
		// renderer the same one — which Strict Mode's double mount does on the
		// very first descent — and it would come back already lost.
		const canvas = document.createElement('canvas')
		canvas.ariaHidden = 'true'
		// `text-brand` so the selection ring can follow the wallpaper's colour,
		// which the shader reads off this element
		canvas.className = 'pointer-events-none absolute inset-x-0 top-0 text-brand'
		hostRef.current!.append(canvas)
		const renderer = createRenderer(canvas, plan, initialCell)
		if (!renderer) {
			canvas.remove()
			latest.current.onLost()
			return
		}
		// The mosaic's rendition is the 192: its cells never exceed 128 device
		// px, and the URL is derived from the id, so every item's is known.
		// `generate` remains only as the retry path for a token that wasn't
		// minted yet when `known` was first asked.
		const source = new ThumbnailSource({
			known: (item) => latest.current.authorize(itemThumbnailUrl(item.id, 192)),
			generate: async (item) => latest.current.authorize(itemThumbnailUrl(item.id, 192)),
			cell: () => renderer.cell,
			holds: renderer.holds,
			deliver: (index, id, bitmap) => {
				renderer.deliver(index, id, bitmap)
				again()
			},
		})
		engine.current = {renderer, source}
		// Very real on iOS under memory pressure. preventDefault asks the
		// browser to restore the context; the grid meanwhile springs the tiles
		// back up to a size the DOM can draw, which reads as a deliberate
		// zoom-out rather than as a crash.
		const lost = (event: Event) => {
			event.preventDefault()
			latest.current.onLost()
		}
		canvas.addEventListener('webglcontextlost', lost)
		return () => {
			canvas.removeEventListener('webglcontextlost', lost)
			cancelAnimationFrame(scheduled.current)
			scheduled.current = 0
			shown.current = null
			source.dispose()
			renderer.dispose()
			canvas.remove()
			engine.current = null
		}
		// The atlas's shape, not the plan object: a plan is recomputed for every
		// pixel the window is dragged, and rebuilding here means a fifty
		// megabyte texture and a thrown-away GL context on every frame of that
		// drag. Nothing the renderer reads changes while the shape holds — the
		// floor is the grid's business, not the atlas's.
	}, [plan.side, plan.layers, initialCell])

	useImperativeHandle(ref, () => ({
		draw(frame, racing) {
			const current = engine.current
			if (!current) return
			cancelAnimationFrame(scheduled.current)
			scheduled.current = 0
			shown.current = frame
			// A photograph part way through its fade keeps the frames coming: the
			// grid draws for its own reasons — a hover, a selection, a scroll —
			// and one of those must not leave a fade stopped half way.
			if (current.renderer.draw(frame)) again()
			// Where the eye is: the pointer or the pinch's midpoint while a
			// gesture owns the grid, the middle of the window otherwise
			const {focal} = frame
			const looking = focal
				? itemAt(frame.layout, Math.min(frame.viewport.width - 1, Math.max(0, focal.x)), frame.scrollTop + focal.y)
				: undefined
			current.source.suspended = racing
			current.source.want(
				frame.layout.items,
				frame.items,
				looking ?? Math.round((frame.items.start + frame.items.end) / 2),
				frame.layout.tile * (devicePixelRatio || 1),
			)
		},
	}))

	// `display: contents`, so the canvas's absolute position resolves against
	// the tile layer exactly as a rendered one would
	return <div ref={hostRef} className='contents' />
}

// The display's pixel ratio, kept current: it changes when the window crosses
// to another screen or the browser is zoomed, and both how far out the grid
// can go and how sharp the canvas is depend on it.
export function useDevicePixelRatio() {
	const [dpr, setDpr] = useState(() => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
	useEffect(() => {
		const query = matchMedia(`(resolution: ${dpr}dppx)`)
		const onChange = () => setDpr(devicePixelRatio || 1)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [dpr])
	return dpr
}
