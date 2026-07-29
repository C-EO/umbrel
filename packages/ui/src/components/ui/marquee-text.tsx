import {motion, useReducedMotion} from 'motion/react'
import {useLayoutEffect, useRef, useState} from 'react'

import {cn} from '@/lib/utils'

// While scrolling, the container extends this far into its leading gap
// (negative margin + padding), so the left fade zone covers empty padding at
// rest and only touches glyphs once they have actually scrolled into it
const EDGE_FADE = 12
const EDGE_FADE_MASK = `linear-gradient(to right, transparent 0, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), transparent 100%)`

// Single-line text that glides continuously from right to left when it
// overflows its container, Apple Music style: rest, one smooth pass at a
// constant speed, rest again at the seamless loop point. Text that fits (or a
// reduced-motion preference) renders as ordinary truncated text.
export function MarqueeText({
	text,
	className,
	// Pixels per second, so long text takes proportionally longer, never faster
	speed = 24,
	// Seconds at rest before the first pass and between passes
	delay = 2,
	// Pixels between the end of the text and its looping copy
	gap = 48,
}: {
	text: string
	className?: string
	speed?: number
	delay?: number
	gap?: number
}) {
	const reducedMotion = useReducedMotion() ?? false
	const containerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLSpanElement>(null)
	// The loop distance when overflowing, 0 while the text fits
	const [shift, setShift] = useState(0)

	// Re-runs when the branch flips (shift 0 ↔ >0) so the observer re-binds to
	// the freshly mounted span; measure reads the refs live for the same
	// reason, since the old span unmounts and would measure as zero wide
	useLayoutEffect(() => {
		const container = containerRef.current
		const textElement = textRef.current
		if (!container || !textElement) return
		const measure = () => {
			const currentContainer = containerRef.current
			const currentText = textRef.current
			if (!currentContainer || !currentText) return
			// getBoundingClientRect works for the inline span of the static branch
			// too, where scrollWidth would always report zero
			const textWidth = currentText.getBoundingClientRect().width
			// clientWidth includes the scrolling branch's fade padding, which is
			// not usable text space; subtract it so the branches agree on the
			// threshold and cannot ping-pong near the boundary
			const available = currentContainer.clientWidth - (currentContainer.dataset.scrolling ? EDGE_FADE : 0)
			const overflowing = textWidth > available + 1
			setShift(overflowing ? Math.ceil(textWidth) + gap : 0)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(container)
		observer.observe(textElement)
		return () => observer.disconnect()
	}, [text, gap, reducedMotion, shift])

	const scrolling = shift > 0 && !reducedMotion

	return (
		<div
			ref={containerRef}
			title={text}
			data-scrolling={scrolling || undefined}
			className={cn('overflow-hidden whitespace-nowrap', !scrolling && 'truncate', className)}
			style={
				scrolling
					? {
							maskImage: EDGE_FADE_MASK,
							WebkitMaskImage: EDGE_FADE_MASK,
							marginLeft: -EDGE_FADE,
							paddingLeft: EDGE_FADE,
						}
					: undefined
			}
		>
			{scrolling ? (
				<motion.div
					// Restart the pass cleanly whenever the text or distance changes
					key={`${text}-${shift}`}
					className='flex w-max items-center'
					style={{gap}}
					initial={{x: 0}}
					animate={{x: -shift}}
					transition={{duration: shift / speed, ease: 'linear', repeat: Infinity, delay, repeatDelay: delay}}
				>
					<span ref={textRef}>{text}</span>
					{/* The looping copy that slides in as the original leaves */}
					<span aria-hidden>{text}</span>
				</motion.div>
			) : (
				<span ref={textRef}>{text}</span>
			)}
		</div>
	)
}
