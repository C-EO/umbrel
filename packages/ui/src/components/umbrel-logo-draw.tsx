import {animate, motion, useMotionValue, useReducedMotion, useTransform} from 'motion/react'
import {useEffect, useId, useRef} from 'react'

import {cn} from '@/lib/utils'

// The mark itself — identical geometry to <UmbrelLogo />, kept here so the
// animation and the static logo can never drift apart.
const MARK =
	'M47.416 8.723c10.404-.2 18.594 2.599 24.948 8.11 4.615 4.002 8.475 9.622 11.46 17.045-2.275-.56-4.679-.835-7.196-.835-5.324 0-10.102 1.232-14.083 3.912-4.46-2.722-9.258-4.152-14.34-4.152-5.198 0-10.188 1.495-14.923 4.302-4.571-2.875-9.722-4.302-15.341-4.302-2.03 0-3.97.188-5.802.582 2.684-6.827 6.235-12.09 10.546-15.946 6.16-5.512 14.278-8.516 24.731-8.716ZM7.761 45.613a4.35 4.35 0 0 0 .472-.493c1.901-2.205 4.878-3.604 9.708-3.604 4.557 0 8.466 1.266 11.884 3.768l.135.1a5.446 5.446 0 0 0 6.304.143c4.085-2.764 8.043-4.011 11.94-4.011 3.83 0 7.545 1.202 11.228 3.817l.076.055a5.446 5.446 0 0 0 6.727-.307c2.433-2.1 5.762-3.325 10.393-3.325 4.871 0 8.648 1.358 11.63 3.875a4.38 4.38 0 0 0 1.632.907 4.336 4.336 0 0 0 2.968-.168 4.364 4.364 0 0 0 2.592-4.66 4.39 4.39 0 0 0-.109-.51c-3.456-13.388-9.106-23.87-17.269-30.95C69.822 3.095 59.422-.222 47.25.012 35.124.245 24.874 3.79 16.876 10.945 8.948 18.037 3.639 28.312.633 41.3a4.352 4.352 0 0 0 2.533 5.081 4.352 4.352 0 0 0 4.595-.767Z'

// The logo is a ring of perfectly constant width (measured: 8.713 units), so it
// is really one closed stroke. This is that stroke's centerline, recovered by
// offsetting the outer contour inward by half the ring width. Drawn from the
// left tip, up and over the canopy, then back through the three scallops to the
// point it started from.
//
// It is fitted tightly (147 cubics, within 0.02 of the true offset) for a
// specific reason: the mark's two inner corners sit at exactly half the ring
// width from BOTH the canopy and the scallop run, so any excess stroke width
// spills past a corner into the half of the ring that has not been drawn yet
// and leaves a sharp wedge hanging off the edge. A loose fit forces a wider
// stroke to stay watertight, which is what makes that wedge visible.
export const UMBREL_LOGO_CENTERLINE =
	'M4.856 42.37C5.005 41.738 4.993 41.789 5.096 41.359C5.207 40.904 5.229 40.818 5.323 40.447C5.506 39.731 5.612 39.338 5.784 38.715C5.974 38.035 6.092 37.632 6.292 36.967C6.5 36.285 6.62 35.911 6.814 35.319C7.028 34.674 7.159 34.291 7.384 33.66C7.617 33.014 7.75 32.659 7.965 32.099C8.21 31.47 8.35 31.125 8.576 30.58C8.833 29.969 8.979 29.634 9.216 29.104C9.478 28.527 9.638 28.185 9.909 27.623C10.19 27.047 10.35 26.732 10.609 26.235C10.894 25.692 11.068 25.371 11.363 24.844C11.669 24.304 11.842 24.009 12.122 23.543C12.431 23.036 12.619 22.736 12.938 22.243C13.268 21.739 13.455 21.464 13.756 21.03C14.273 20.294 14.66 19.77 15.327 18.923C15.785 18.353 15.875 18.248 16.261 17.793C16.676 17.314 16.736 17.246 17.16 16.78C17.649 16.253 17.744 16.156 18.155 15.737C18.66 15.232 18.759 15.139 19.183 14.738C19.704 14.257 19.806 14.167 20.248 13.781C20.723 13.375 20.791 13.318 21.273 12.927C21.828 12.487 21.936 12.406 22.4 12.059C22.968 11.643 23.079 11.567 23.555 11.239C24.138 10.847 24.251 10.776 24.739 10.468C25.263 10.145 25.338 10.099 25.871 9.79C26.483 9.443 26.602 9.38 27.113 9.108C27.74 8.784 27.862 8.726 28.386 8.473C29.028 8.172 29.153 8.118 29.689 7.884C30.266 7.64 30.349 7.606 30.934 7.375C31.607 7.117 31.737 7.071 32.299 6.873C32.902 6.668 32.989 6.639 33.601 6.446C34.304 6.233 34.441 6.195 35.028 6.033C35.591 5.883 35.591 5.884 35.899 5.806C36.463 5.667 36.804 5.589 37.378 5.465C37.97 5.34 38.303 5.276 38.839 5.178C39.427 5.074 39.783 5.016 40.382 4.927C41 4.837 41.347 4.793 41.905 4.727C42.518 4.657 42.889 4.619 43.512 4.565C44.156 4.511 44.517 4.486 45.098 4.452C45.753 4.416 46.121 4.401 46.713 4.383C47.385 4.364 47.755 4.359 48.348 4.357C48.994 4.357 49.378 4.362 50.014 4.379C50.666 4.399 51.025 4.415 51.595 4.447C52.217 4.485 52.587 4.512 53.199 4.566C53.826 4.624 54.172 4.662 54.72 4.728C55.318 4.802 55.674 4.852 56.262 4.943C56.865 5.039 57.197 5.098 57.723 5.198C58.314 5.312 58.64 5.381 59.155 5.497C59.546 5.587 59.676 5.617 60.318 5.78C60.944 5.945 61.033 5.97 61.65 6.149C62.35 6.36 62.482 6.403 63.048 6.591C63.733 6.826 63.862 6.874 64.416 7.082C65.086 7.341 65.212 7.393 65.753 7.621C66.328 7.869 66.409 7.906 66.975 8.168C67.618 8.474 67.738 8.536 68.257 8.802C68.885 9.133 69.003 9.2 69.51 9.486C70.124 9.842 70.239 9.913 70.735 10.22C71.261 10.554 71.336 10.602 71.854 10.951C72.442 11.355 72.552 11.436 73.027 11.783C73.601 12.213 73.709 12.299 74.172 12.668C74.733 13.124 74.839 13.215 75.291 13.605C75.765 14.023 75.832 14.083 76.298 14.515C76.825 15.015 76.923 15.113 77.347 15.538C77.796 15.996 77.859 16.063 78.299 16.535C78.796 17.081 78.889 17.188 79.289 17.651C79.501 17.899 79.531 17.935 79.741 18.188C80.11 18.636 80.328 18.91 80.687 19.375C81.055 19.855 81.256 20.128 81.574 20.569C81.92 21.054 82.125 21.35 82.462 21.852C82.807 22.371 82.995 22.665 83.292 23.14C83.617 23.663 83.808 23.981 84.123 24.52C84.444 25.078 84.62 25.393 84.897 25.902C85.207 26.478 85.377 26.804 85.643 27.33C85.943 27.924 86.106 28.261 86.362 28.803C86.642 29.4 86.807 29.763 87.077 30.376C87.353 31.009 87.503 31.367 87.739 31.943C88.003 32.595 88.147 32.962 88.373 33.555C88.626 34.225 88.764 34.604 88.979 35.213C89.214 35.882 89.352 36.289 89.577 36.975C89.807 37.682 89.931 38.081 90.126 38.723C90.344 39.449 90.462 39.858 90.647 40.516C90.811 41.107 91.008 41.829 91.137 42.362C90.506 41.831 90.184 41.589 89.637 41.198C88.982 40.746 88.643 40.537 88.124 40.235C87.32 39.779 86.712 39.481 85.913 39.141C85.416 38.935 85.168 38.841 84.722 38.683C84.209 38.507 83.953 38.428 83.493 38.295C82.964 38.149 82.7 38.084 82.227 37.978C81.733 37.872 81.484 37.824 80.979 37.739C80.422 37.65 80.144 37.614 79.646 37.558C79.075 37.499 78.791 37.477 78.281 37.446C77.696 37.415 77.405 37.407 76.883 37.401C76.35 37.398 76.093 37.402 75.587 37.418C75.031 37.439 74.763 37.457 74.289 37.494C73.749 37.542 73.489 37.572 73.029 37.632C72.304 37.734 71.924 37.803 71.259 37.943C70.579 38.097 70.247 38.184 69.595 38.381C68.883 38.607 68.544 38.734 67.952 38.975C67.281 39.261 66.962 39.416 66.408 39.708C65.781 40.051 65.486 40.234 64.973 40.573C64.447 40.933 64.194 41.122 63.705 41.517C63.141 41.987 63.037 42.073 62.494 42.033C62.15 41.941 62.146 41.918 61.868 41.72C61.61 41.539 61.61 41.539 61.35 41.363C60.892 41.057 60.666 40.913 60.262 40.665C59.84 40.41 59.628 40.287 59.203 40.051C58.737 39.798 58.512 39.683 58.041 39.452C57.327 39.112 56.974 38.96 56.34 38.707C55.614 38.428 55.255 38.306 54.612 38.107C53.943 37.909 53.607 37.822 52.932 37.669C52.187 37.511 51.82 37.449 51.165 37.357C50.484 37.27 50.143 37.237 49.461 37.195C48.711 37.157 48.34 37.154 47.673 37.166C46.976 37.187 46.627 37.208 45.928 37.275C45.158 37.358 44.78 37.415 44.107 37.534C43.33 37.682 42.943 37.774 42.362 37.925C41.469 38.165 40.821 38.375 39.998 38.68C39.491 38.872 39.243 38.974 38.801 39.163C38.296 39.384 38.049 39.499 37.61 39.712C37.109 39.96 36.863 40.089 36.426 40.326C35.973 40.576 35.747 40.706 35.296 40.976C34.8 41.277 34.557 41.433 34.126 41.716C33.574 42.084 33.434 42.166 32.901 42.06C32.583 41.932 32.554 41.884 32.336 41.723C32.087 41.544 32.087 41.544 31.836 41.369C31.431 41.092 31.227 40.958 30.812 40.699C30.354 40.418 30.125 40.287 29.714 40.06C29.242 39.804 29.007 39.685 28.585 39.481C28.1 39.251 27.859 39.146 27.425 38.965C26.974 38.781 26.746 38.694 26.285 38.53C25.777 38.353 25.524 38.274 25.072 38.14C24.552 37.991 24.294 37.925 23.833 37.815C23.303 37.694 23.041 37.642 22.571 37.556C22.082 37.472 21.835 37.434 21.34 37.369C20.792 37.302 20.521 37.276 20.037 37.238C19.482 37.198 19.207 37.185 18.716 37.17C18.161 37.157 17.875 37.157 17.351 37.166C16.817 37.179 16.555 37.191 16.038 37.225C15.472 37.268 15.201 37.296 14.723 37.356C14.18 37.428 13.919 37.472 13.459 37.558C12.869 37.675 12.509 37.757 11.822 37.951C11.152 38.151 10.826 38.265 10.193 38.518C9.504 38.808 9.18 38.969 8.619 39.275C8.045 39.602 7.77 39.778 7.242 40.152C6.672 40.574 6.41 40.797 5.963 41.205C5.528 41.618 5.287 41.864 4.856 42.37Z'

// The reveal needs two stroke widths, because one cannot do both jobs. EDGE is
// barely wider than the ring, so the leading edge and the tips are exact — but
// it hugs the mark's own outline so closely that the mask's antialiasing eats
// into the silhouette. COVER is comfortably wider and keeps the silhouette
// watertight, but it is the width that spills past the inner corners. So COVER
// does the filling well behind the head, and is held GUARD of the path clear of
// either tip until the mark is finished and the corners no longer matter.
const EDGE = 8.76
const COVER = 9.5
const GUARD = 0.075
const TIP = {x: 4.856, y: 42.37} // where the stroke starts, and where it lands
const DOT_R = 4.6

// Arc-length landmarks, measured on the centerline above. The canopy is the
// first 57%; the three scallops that follow divide the rest into near-perfect
// thirds, which is why the return leg can keep an even rhythm.
const CANOPY_END = 0.5745
const VALLEY_1 = 0.7148
const VALLEY_2 = 0.8601

// Beat lengths in seconds. The whole mark is drawn in about 1.6s — fast enough
// to feel decisive on a setup screen, slow enough to read as drawn rather than
// wiped on. Anything longer and the page behind it is just waiting.
const BEAT = {
	dot: 0.2, // the circle blooms at the left tip
	settle: 0.04, // a breath before it takes off
	canopy: 0.66, // one confident sweep up, over and down
	turn: 0.07, // the pen stops to reverse — a 180° turn has to cost something
	scallops: 0.64, // three inward curves, evenly paced
	close: 0.38, // the tip glow lifts away and the mark is left at rest
}
const DRAW = BEAT.dot + BEAT.settle + BEAT.canopy + BEAT.turn + BEAT.scallops
const TOTAL = DRAW + BEAT.close

// Launch hard, glide long into the far tip.
const CANOPY_EASE = [0.5, 0, 0.22, 1] as const
// The three scallops hand velocity to each other rather than stopping between
// them: each ease leaves at the same rate the next one enters, and only the
// last one decelerates to rest on the starting point.
const ARC_IN = [0.35, 0, 0.6, 0.82] as const
const ARC_THROUGH = [0.4, 0.18, 0.6, 0.82] as const
const ARC_LAND = [0.4, 0.18, 0.25, 1] as const
const DOT_EASE = [0.34, 1.2, 0.64, 1] as const

const at = (seconds: number) => seconds / TOTAL

export function UmbrelLogoDraw({
	className,
	restOpacity = 0.85,
	delay = 0,
	speed = 1,
	onComplete,
}: {
	className?: string
	/** Opacity the mark settles at — matches the static logo's 85% by default. */
	restOpacity?: number
	delay?: number
	/** Playback rate — 0.5 runs the whole sequence at half speed. */
	speed?: number
	onComplete?: () => void
}) {
	const raw = useId().replace(/[^a-zA-Z0-9]/g, '')
	const revealId = `umbrel-draw-reveal-${raw}`
	const headId = `umbrel-draw-head-${raw}`
	const bloomId = `umbrel-draw-bloom-${raw}`

	const reduceMotion = useReducedMotion()

	const progress = useMotionValue(0)
	const dotR = useMotionValue(0)
	const bloom = useMotionValue(0)
	const guard = useMotionValue(1)

	const rulerRef = useRef<SVGPathElement>(null)
	const lengthRef = useRef(0)

	useEffect(() => {
		lengthRef.current = rulerRef.current?.getTotalLength() ?? 0
	}, [])

	useEffect(() => {
		// Reduced motion renders the plain mark below, so there is nothing to drive.
		if (reduceMotion) {
			onComplete?.()
			return
		}

		const m = {
			dot: at(BEAT.dot),
			start: at(BEAT.dot + BEAT.settle),
			farTip: at(BEAT.dot + BEAT.settle + BEAT.canopy),
			turned: at(BEAT.dot + BEAT.settle + BEAT.canopy + BEAT.turn),
			arc1: at(BEAT.dot + BEAT.settle + BEAT.canopy + BEAT.turn + BEAT.scallops / 3),
			arc2: at(BEAT.dot + BEAT.settle + BEAT.canopy + BEAT.turn + (BEAT.scallops * 2) / 3),
			drawn: at(DRAW),
		}

		const duration = TOTAL / speed

		const runs = [
			// Let COVER reach into the tips only once everything has been drawn.
			animate(guard, [1, 1, 0], {duration, delay, times: [0, m.drawn, 1], ease: 'easeInOut'}),
			animate(progress, [0, 0, 0, CANOPY_END, CANOPY_END, VALLEY_1, VALLEY_2, 1, 1], {
				duration,
				delay,
				times: [0, m.dot, m.start, m.farTip, m.turned, m.arc1, m.arc2, m.drawn, 1],
				ease: ['linear', 'linear', CANOPY_EASE, 'linear', ARC_IN, ARC_THROUGH, ARC_LAND, 'linear'],
				onComplete,
			}),
			animate(dotR, [0, DOT_R, DOT_R], {
				duration,
				delay,
				times: [0, m.dot, 1],
				ease: [DOT_EASE, 'linear'],
			}),
			// The tip glow simply lifts away as the loop closes. It must not flare
			// on completion: the mark is already at its resting opacity, so any
			// last-moment brightening reads as a flicker rather than a finish.
			animate(bloom, [0, 0.5, 0.42, 0.42, 0], {
				duration,
				delay,
				times: [0, m.dot, m.turned, m.drawn, 1],
				ease: ['easeOut', 'linear', 'linear', [0.4, 0, 0.2, 1]],
			}),
		]

		return () => runs.forEach((run) => run.stop())
	}, [reduceMotion, restOpacity, delay, speed])

	// A zero-length dash with a round linecap still paints a full-size dot, so the
	// reveal strokes have to stay hidden until they actually have length.
	const revealOpacity = useTransform(progress, (p) => (p <= 0.0001 ? 0 : 1))

	// COVER trails the head by GUARD and starts GUARD in, so it never reaches a
	// tip while the other half of the ring is still undrawn.
	const coverOffset = useTransform(guard, (g) => GUARD * g)
	const coverLength = useTransform([progress, guard], ([p, g]: number[]) => Math.max(0, p - 2 * GUARD * g))
	const coverOpacity = useTransform(coverLength, (l) => (l <= 0.0001 ? 0 : 1))

	// A short window of stroke trailing the head, painted brighter — the wet-ink
	// tip that makes the mark feel written rather than wiped in.
	const HEAD_SPAN = 0.055
	// Sits over the mark at full resting opacity, so it needs to be strong enough
	// to still read as a wet tip without blowing out to pure white.
	const HEAD_GLOW = 0.62
	const headLength = useTransform(progress, (p) => Math.min(HEAD_SPAN, p))
	const headOffset = useTransform(progress, (p) => Math.max(0, p - HEAD_SPAN))
	const headOpacity = useTransform(progress, (p) => {
		if (p <= 0.0005 || p >= 1) return 0
		if (p < 0.04) return (p / 0.04) * HEAD_GLOW
		if (p > 0.96) return ((1 - p) / 0.04) * HEAD_GLOW
		return HEAD_GLOW
	})

	const pointAt = (p: number) => {
		const el = rulerRef.current
		if (!el || !lengthRef.current) return TIP
		return el.getPointAtLength(p * lengthRef.current)
	}
	const bloomX = useTransform(progress, (p) => pointAt(p).x)
	const bloomY = useTransform(progress, (p) => pointAt(p).y)

	// Nothing is drawn when the viewer asks for less motion — just the finished
	// mark. Deliberately built without motion values: a value set outside a frame
	// does not flush derived styles, which would leave the reveal half applied.
	if (reduceMotion) {
		return (
			<svg
				xmlns='http://www.w3.org/2000/svg'
				width={96}
				viewBox='0 0 96 47'
				fill='none'
				aria-hidden
				className={cn('overflow-visible', className)}
			>
				<path d={MARK} fill='currentColor' fillRule='evenodd' clipRule='evenodd' opacity={restOpacity} />
			</svg>
		)
	}

	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={96}
			viewBox='0 0 96 47'
			fill='none'
			aria-hidden
			className={cn('overflow-visible', className)}
		>
			<defs>
				{/* Measuring stick for the travelling bloom. Never painted. */}
				<path ref={rulerRef} d={UMBREL_LOGO_CENTERLINE} />

				<radialGradient id={bloomId}>
					<stop offset='0%' stopColor='white' stopOpacity='0.85' />
					<stop offset='40%' stopColor='white' stopOpacity='0.22' />
					<stop offset='100%' stopColor='white' stopOpacity='0' />
				</radialGradient>

				{/* Revealing through a mask rather than clipping the stroke keeps the
				    mark's own edges crisp — only the advancing front is soft. */}
				<mask id={revealId}>
					<motion.path
						d={UMBREL_LOGO_CENTERLINE}
						stroke='white'
						strokeWidth={COVER}
						strokeLinecap='round'
						strokeLinejoin='round'
						fill='none'
						style={{pathLength: coverLength, pathOffset: coverOffset, opacity: coverOpacity}}
					/>
					<motion.path
						d={UMBREL_LOGO_CENTERLINE}
						stroke='white'
						strokeWidth={EDGE}
						strokeLinecap='round'
						strokeLinejoin='round'
						fill='none'
						style={{pathLength: progress, opacity: revealOpacity}}
					/>
					<motion.circle cx={TIP.x} cy={TIP.y} fill='white' style={{r: dotR}} />
				</mask>

				<mask id={headId}>
					<motion.path
						d={UMBREL_LOGO_CENTERLINE}
						stroke='white'
						strokeWidth={EDGE}
						strokeLinecap='round'
						strokeLinejoin='round'
						fill='none'
						style={{pathLength: headLength, pathOffset: headOffset}}
					/>
				</mask>
			</defs>

			<motion.path
				d={MARK}
				fill='currentColor'
				fillRule='evenodd'
				clipRule='evenodd'
				mask={`url(#${revealId})`}
				opacity={restOpacity}
			/>

			<motion.path
				d={MARK}
				fill='white'
				fillRule='evenodd'
				clipRule='evenodd'
				mask={`url(#${headId})`}
				style={{opacity: headOpacity}}
			/>

			<motion.circle r={7} fill={`url(#${bloomId})`} style={{x: bloomX, y: bloomY, opacity: bloom}} />
		</svg>
	)
}

export default UmbrelLogoDraw
