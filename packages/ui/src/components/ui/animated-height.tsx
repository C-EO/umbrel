import {motion, useReducedMotion, type Transition} from 'motion/react'
import {useEffect, useRef, useState} from 'react'

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

	useEffect(() => {
		const element = contentRef.current
		if (!element) return

		const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	return (
		<motion.div
			initial={false}
			animate={{height}}
			transition={shouldReduceMotion ? {duration: 0} : transition}
			className='overflow-hidden'
		>
			<div ref={contentRef} className={contentClassName}>
				{children}
			</div>
		</motion.div>
	)
}
