import {motion, useReducedMotion, type Transition} from 'motion/react'
import {useEffect, useRef, useState} from 'react'

// Height changes landing within this window after mount snap into place
// instead of animating: they come from content settling in (e.g. queries
// resolving right as a dialog opens), and animating them during the entrance
// shows a clipped mid-flight frame.
const MOUNT_SETTLE_MS = 500

// Smoothly follows the natural height of dynamic content. ResizeObserver keeps
// the animation in sync with both view swaps and changes within the active view.
export function AnimatedHeight({
	children,
	transition = {type: 'spring', duration: 0.35, bounce: 0},
	contentClassName,
}: {
	children: React.ReactNode
	transition?: Transition
	contentClassName?: string
}) {
	const contentRef = useRef<HTMLDivElement>(null)
	const [height, setHeight] = useState<number | 'auto'>('auto')
	const shouldReduceMotion = useReducedMotion()
	const snapRef = useRef(true)

	useEffect(() => {
		const element = contentRef.current
		if (!element) return

		const mountedAt = performance.now()
		const observer = new ResizeObserver(() => {
			// Set before setHeight so the render triggered by it sees the fresh value
			snapRef.current = performance.now() - mountedAt < MOUNT_SETTLE_MS
			setHeight(element.offsetHeight)
		})
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	return (
		<motion.div
			initial={false}
			animate={{height}}
			transition={shouldReduceMotion || snapRef.current ? {duration: 0} : transition}
			className='overflow-hidden'
		>
			<div ref={contentRef} className={contentClassName}>
				{children}
			</div>
		</motion.div>
	)
}
