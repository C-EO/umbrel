import {useEffect, useRef, useState} from 'react'

// Hovering a live photo's tile brings it to life: rest a mouse on one for a
// beat and its motion clip fades in over the still, looping quietly until
// the pointer moves on. One delegated pointerover/out pair on the grid's
// content — the tiles stay the bare pictures they are (see TileLayer), and
// only the single hovered tile ever mounts a video (see ItemTile's clip).
//
// The dwell is the fetch gate: sweeping the cursor across a dense grid must
// not spray a MOV request per tile crossed, so nothing happens until the
// pointer has rested DWELL_MS on one tile. Leaving lets the clip linger a
// beat, paused and fading, so the motion settles back into the still
// instead of cutting — unless another tile's dwell claims the one slot
// first. Mouse pointers only: touch has no hover, and its press-and-hold
// belongs to the lightbox.
const DWELL_MS = 300
const LINGER_MS = 250
// Tiles below this are all badge-less shimmer (the badges' own @min-[88px]
// threshold) — motion that small reads as flicker, not as the moment
export const LIVE_MIN_TILE = 88

// The one clip slot: which tile's clip is mounted, and whether it should be
// playing (false = lingering out after the pointer left)
type Clip = {id: string; active: boolean}

export function useLiveHover({enabled, isLive}: {enabled: boolean; isLive: (id: string) => boolean}) {
	const [clip, setClip] = useState<Clip>()
	// The slot, mirrored in a ref for the handlers: a pointer event can land
	// in the gap between a timer's setClip and React's re-render, and a
	// stale closure there would skip the stop — a clip looping with no
	// pointer anywhere near it. The state stays what renders.
	const clipRef = useRef<Clip>(undefined)
	const setSlot = (next: Clip | undefined) => {
		clipRef.current = next
		setClip(next)
	}
	// The tile the pointer is in — over/out both funnel into hoverChange, and
	// this makes the pair idempotent (child crossings refire them constantly)
	const hoverRef = useRef<string>(undefined)
	const dwellRef = useRef<number>(undefined)
	const lingerRef = useRef<number>(undefined)
	useEffect(
		() => () => {
			window.clearTimeout(dwellRef.current)
			window.clearTimeout(lingerRef.current)
		},
		[],
	)

	// `buttons`: a pressed button means a drag (the marquee, a text-ish
	// sweep) — tiles crossed mid-drag are being dragged over, not looked at
	const hoverChange = (id: string | undefined, buttons: number) => {
		if (id === hoverRef.current) return
		hoverRef.current = id
		window.clearTimeout(dwellRef.current)
		const clip = clipRef.current
		if (clip) {
			// Back on the lingering tile: pick the playback right back up
			if (id === clip.id) {
				window.clearTimeout(lingerRef.current)
				if (!clip.active) setSlot({id: clip.id, active: true})
				return
			}
			if (clip.active) {
				setSlot({id: clip.id, active: false})
				lingerRef.current = window.setTimeout(() => setSlot(undefined), LINGER_MS)
			}
		}
		if (id && enabled && buttons === 0 && isLive(id)) {
			dwellRef.current = window.setTimeout(() => {
				// The linger's unmount must not take the slot this claims
				window.clearTimeout(lingerRef.current)
				setSlot({id, active: true})
			}, DWELL_MS)
		}
	}

	const tileId = (target: EventTarget | null) =>
		target instanceof Element ? target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId : undefined

	return {
		clip,
		handlers: {
			onPointerOver: (event: React.PointerEvent) => {
				if (event.pointerType !== 'mouse') return
				hoverChange(tileId(event.target), event.buttons)
			},
			// Out covers what over can't: leaving the grid (or the window)
			// entirely, where no tile's over will ever fire
			onPointerOut: (event: React.PointerEvent) => {
				if (event.pointerType !== 'mouse') return
				hoverChange(tileId(event.relatedTarget), event.buttons)
			},
		},
	}
}
