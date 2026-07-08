import React, {Fragment, useEffect, useId, useRef, useState, useSyncExternalStore} from 'react'

import {attachBackdropLens, type GlassLensParams} from '@/lib/glass-webgl'
import {cn} from '@/lib/utils'

// Glass surface:
// A canvas-generated displacement map (R = bend-x, G = bend-y, 128 = neutral;
// computed for the top-left quadrant and mirrored) feeds an SVG
// feDisplacementMap that bends the page behind the element, displaced per
// color channel for a faint chromatic fringe at the rim. The falloff is
// Snell's law through a convex dome profile.
// Chromium renders the lens via backdrop-filter: url(); Safari/Firefox parse
// that but paint nothing, so they get frosted blur instead.

const IOR = 1.5 // refractive index of the dome (real glass)
const MAX_BEND = Math.cos(Math.asin(1 / IOR)) // bend at a 90° rim

const REDUCED = window.matchMedia('(prefers-reduced-transparency: reduce)').matches

// Matches the `contrast-more:` styles callers layer on: solid backgrounds, no
// blur. Watched live (like the CSS variants it replaces), not snapshotted.
const CONTRAST_QUERY = window.matchMedia('(prefers-contrast: more)')

function subscribeContrast(onChange: () => void) {
	CONTRAST_QUERY.addEventListener('change', onChange)
	return () => CONTRAST_QUERY.removeEventListener('change', onChange)
}

const FROSTED =
	(CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')) &&
	!REDUCED &&
	!CONTRAST_QUERY.matches

const REFRACT =
	FROSTED &&
	/Chrom(e|ium)/.test(navigator.userAgent) &&
	!/iP(hone|ad|od)/.test(navigator.userAgent) &&
	CSS.supports('backdrop-filter', 'url(#g)')

// The map ships as a blob: URL, not canvas.toDataURL() — umbreld's CSP is
// `img-src * blob:`, so data: URIs are blocked and feImage would load nothing.
function buildLensMap(
	w: number,
	h: number,
	radius: number,
	bevelFrac: number,
	onReady: (href: string | null) => void,
): void {
	const q = 2 // supersample for a smooth rim
	const W = Math.max(2, Math.round(w * q))
	const H = Math.max(2, Math.round(h * q))
	const R = Math.min(radius * q, W / 2, H / 2)
	const canvas = document.createElement('canvas')
	canvas.width = W
	canvas.height = H
	const ctx = canvas.getContext('2d')
	if (!ctx) return onReady(null)
	const img = ctx.createImageData(W, H)
	const d = img.data
	const cx = W / 2
	const cy = H / 2
	const bevel = Math.max(2, bevelFrac * Math.min(cx, cy))

	function put(x: number, y: number, dx: number, dy: number) {
		const i = (y * W + x) * 4
		d[i] = 128 + dx * 127
		d[i + 1] = 128 + dy * 127
		d[i + 2] = 128
		d[i + 3] = 255
	}

	for (let y = 0; y < cy; y++) {
		for (let x = 0; x < cx; x++) {
			const px = x + 0.5 - cx // ≤ 0 in this quadrant
			const py = y + 0.5 - cy
			const qx = Math.abs(px) - (cx - R)
			const qy = Math.abs(py) - (cy - R)
			const ox = Math.max(qx, 0)
			const oy = Math.max(qy, 0)
			const sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R
			let dx = 0
			let dy = 0
			if (sdf < 0 && sdf > -bevel) {
				const u = -sdf / bevel // 0 at the rim → 1 where the dome flattens
				const slope = Math.pow(1 - u, 3) / Math.pow(1 - Math.pow(1 - u, 4), 0.75)
				const thetaI = Math.atan(slope)
				const t = Math.sin(thetaI - Math.asin(Math.sin(thetaI) / IOR)) / MAX_BEND
				if (qx > 0 && qy > 0) {
					// corner: bend along the corner normal
					const len = Math.hypot(ox, oy) || 1
					dx = (ox / len) * -t
					dy = (oy / len) * -t
				} else if (qx > qy) {
					dx = -t
				} else {
					dy = -t
				}
			}
			const xm = W - 1 - x
			const ym = H - 1 - y
			put(x, y, dx, dy)
			put(xm, y, -dx, dy)
			put(x, ym, dx, -dy)
			put(xm, ym, -dx, -dy)
		}
	}
	ctx.putImageData(img, 0, 0)
	canvas.toBlob((blob) => onReady(blob ? URL.createObjectURL(blob) : null))
}

/** The element's own rounding shapes the lens; % and 9999px clamp to a pill. */
function resolveRadius(borderRadius: string, w: number, h: number): number {
	const v = parseFloat(borderRadius) || 0
	const px = borderRadius.includes('%') ? (Math.min(w, h) * v) / 100 : v
	return Math.min(px, w / 2, h / 2)
}

type Lens = {href: string; w: number; h: number; radius: number; bevel: number; ver: number}

type GlassProps = {
	/** Host element. `button` makes the whole surface interactive (widgets). */
	as?: 'div' | 'button'
	/** Backdrop blur inside the lens (px). Frosted-fallback browsers get 3×. */
	blur?: number
	saturate?: number
	brightness?: number
	/** Max refraction offset at the rim (px). */
	scale?: number
	/** Per-channel displacement spread → chromatic fringe. 0 disables. */
	chroma?: number
	/** Rim width as a fraction of the half min-dimension. */
	bevel?: number
	/** CSS background layered over the refracted backdrop. */
	tint?: string
	/** Gradient top-shine border (the dock treatment). */
	shine?: boolean
	/**
	 * An <img>/<video> this glass sits directly on top of (the wallpaper).
	 * Where backdrop-filter: url() can't refract (Safari/Firefox), the lens
	 * renders via WebGL from that element's own pixels instead of falling back
	 * to frosted blur. Only pass it when nothing else can come between the
	 * glass and this element — the lens can't see other content.
	 */
	refractionTarget?: React.RefObject<HTMLImageElement | HTMLVideoElement | null>
} & React.HTMLAttributes<HTMLElement>

export function Glass({
	as = 'div',
	blur = 1.5,
	saturate = 1.5,
	brightness = 0.9,
	scale = 66,
	chroma = 0.2,
	bevel = 0.5,
	tint,
	shine = true,
	refractionTarget,
	className,
	children,
	...rest
}: GlassProps) {
	const hostRef = useRef<HTMLDivElement & HTMLButtonElement>(null)
	const verRef = useRef(0)
	const builtRef = useRef<{w: number; h: number; radius: number; bevel: number} | null>(null)
	const hrefRef = useRef<string | null>(null)
	const [lens, setLens] = useState<Lens | null>(null)
	const filterId = 'glass-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')

	useEffect(() => {
		if (!REFRACT) return
		const host = hostRef.current
		if (!host) return
		let frame = 0
		let timer: ReturnType<typeof setTimeout> | undefined
		function rebuild() {
			frame = 0
			const w = host!.offsetWidth
			const h = host!.offsetHeight
			if (w < 2 || h < 2) return
			const radius = resolveRadius(getComputedStyle(host!).borderRadius, w, h)
			const built = builtRef.current
			if (built && built.w === w && built.h === h && built.radius === radius && built.bevel === bevel) return
			builtRef.current = {w, h, radius, bevel}
			const ver = ++verRef.current
			buildLensMap(w, h, radius, bevel, (href) => {
				// A newer build superseded this one while the blob was encoding
				if (ver !== verRef.current) {
					if (href) URL.revokeObjectURL(href)
					return
				}
				if (!href) {
					// Failed encode: forget the attempt so a later resize retries
					builtRef.current = null
					return
				}
				// Decode before committing: pointing the filter at a map the
				// compositor hasn't loaded yet paints frames with a zero map,
				// lurching the whole refracted backdrop by scale/2.
				const img = new Image()
				img.onload = () => {
					if (ver !== verRef.current) {
						URL.revokeObjectURL(href)
						return
					}
					if (hrefRef.current) URL.revokeObjectURL(hrefRef.current)
					hrefRef.current = href
					setLens({href, w, h, radius, bevel, ver})
				}
				img.onerror = () => {
					URL.revokeObjectURL(href)
					builtRef.current = null
				}
				img.src = href
			})
		}
		function queue() {
			// Build the first lens on the next frame. Once one is showing, wait
			// for the size to settle instead: the dock magnification resizes the
			// host every frame, and rebuilding per frame would encode a PNG per
			// frame and flicker through half-built maps. The resting lens keeps
			// refracting (slightly misaligned) until the animation stops.
			if (timer) clearTimeout(timer)
			if (!hrefRef.current) {
				if (!frame) frame = requestAnimationFrame(rebuild)
			} else {
				timer = setTimeout(rebuild, 150)
			}
		}
		queue()
		const ro = new ResizeObserver(queue)
		ro.observe(host)
		return () => {
			ro.disconnect()
			if (frame) cancelAnimationFrame(frame)
			if (timer) clearTimeout(timer)
			// Invalidate in-flight builds so a late toBlob callback revokes its
			// blob URL instead of publishing after cleanup
			verRef.current++
		}
	}, [bevel])

	useEffect(() => {
		return () => {
			if (hrefRef.current) URL.revokeObjectURL(hrefRef.current)
		}
	}, [])

	const contrast = useSyncExternalStore(subscribeContrast, () => CONTRAST_QUERY.matches)

	// Safari/Firefox with a wallpaper backdrop we own: refract via WebGL from
	// its pixels instead of frosted blur. The canvas stays hidden (and the
	// frosted fallback active) until the lens has drawn its first frame.
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [canvasLens, setCanvasLens] = useState(false)
	// Keep the latest lens params in a ref so attachBackdropLens can read them
	// live (per frame) instead of re-attaching — which would tear down the WebGL
	// context and re-upload the wallpaper texture on every param change.
	const lensParamsRef = useRef<GlassLensParams>({scale, chroma, bevel, saturate, brightness, blur})
	useEffect(() => {
		lensParamsRef.current = {scale, chroma, bevel, saturate, brightness, blur}
	})
	useEffect(() => {
		if (REFRACT || REDUCED || contrast || !refractionTarget) return
		const canvas = canvasRef.current
		if (!canvas) return
		const detach = attachBackdropLens(
			canvas,
			() => refractionTarget.current,
			() => lensParamsRef.current,
			() => setCanvasLens(true),
		)
		if (!detach) return
		return () => {
			detach()
			setCanvasLens(false)
		}
	}, [refractionTarget, contrast])

	// Fresh id per rebuild — Chromium caches filter output by id.
	const id = lens ? `${filterId}-${lens.ver}` : filterId
	const backdropFilter =
		contrast || canvasLens
			? undefined
			: REFRACT && lens
				? `url("#${id}") blur(${blur}px) saturate(${saturate}) brightness(${brightness})`
				: `blur(${blur * 3}px) saturate(${saturate}) brightness(${brightness})`

	const channels = [
		{key: 'cr', s: scale * (1 + chroma), m: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'},
		{key: 'cg', s: scale, m: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'},
		{key: 'cb', s: scale * (1 - chroma), m: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'},
	]

	// A position utility in className takes over from the relative default
	// (inline position would be unoverridable; utility order in CSS is not).
	const positioned = /(?:^|\s)(?:absolute|fixed|sticky|relative)(?:\s|$)/.test(className ?? '')

	const Host = as
	return (
		<Host ref={hostRef} className={cn(!positioned && 'relative', 'isolate', className)} {...rest}>
			{!REFRACT && refractionTarget && (
				<canvas
					ref={canvasRef}
					aria-hidden
					className={cn(
						'pointer-events-none absolute inset-0 -z-10 size-full rounded-[inherit]',
						!canvasLens && 'opacity-0',
					)}
				/>
			)}
			<div
				aria-hidden
				className='pointer-events-none absolute inset-0 -z-10 rounded-[inherit]'
				style={{
					WebkitBackdropFilter: backdropFilter,
					backdropFilter,
					background: tint,
				}}
			/>
			{shine && (
				<div
					aria-hidden
					className='pointer-events-none absolute inset-0 -z-10 rounded-[inherit] border-hpx border-white/10 shadow-glass-button'
				/>
			)}
			{children}
			{REFRACT && lens && (
				<svg width={0} height={0} aria-hidden className='pointer-events-none fixed'>
					<filter
						id={id}
						x={0}
						y={0}
						width={lens.w}
						height={lens.h}
						filterUnits='userSpaceOnUse'
						colorInterpolationFilters='sRGB'
					>
						<feImage
							href={lens.href}
							x={0}
							y={0}
							width={lens.w}
							height={lens.h}
							preserveAspectRatio='none'
							result='map'
						/>
						{channels.map((c) => (
							<Fragment key={c.key}>
								<feDisplacementMap
									in='SourceGraphic'
									in2='map'
									scale={c.s}
									xChannelSelector='R'
									yChannelSelector='G'
									result={`d${c.key}`}
								/>
								<feColorMatrix in={`d${c.key}`} type='matrix' values={c.m} result={c.key} />
							</Fragment>
						))}
						<feBlend in='cr' in2='cg' mode='screen' result='crg' />
						<feBlend in='crg' in2='cb' mode='screen' />
					</filter>
				</svg>
			)}
		</Host>
	)
}
