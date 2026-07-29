import {motion, useReducedMotion} from 'motion/react'

import {cn} from '@/lib/utils'

// Thin progress bar for cloud transfers: a brand fill with a soft
// shimmer sweep while determinate, and an honest pulsing segment when totals
// are unknown. The shimmer stays inside the filled portion and is disabled for
// reduced-motion users.
export function CloudProgressBar({percent, className}: {percent?: number; className?: string}) {
	const reducedMotion = useReducedMotion()

	return (
		<div className={cn('relative h-1 overflow-hidden rounded-full bg-white/15', className)}>
			{percent === undefined ? (
				<div className='h-full w-1/3 animate-pulse rounded-full bg-brand' />
			) : (
				<div
					className='relative h-full overflow-hidden rounded-full bg-brand transition-all duration-300'
					style={{width: `${Math.min(100, percent)}%`}}
				>
					{!reducedMotion && (
						<motion.div
							className='absolute inset-y-0 w-10 bg-white/25 blur-[6px]'
							animate={{left: ['-20%', '110%']}}
							transition={{repeat: Infinity, duration: 1.8, ease: 'linear'}}
						/>
					)}
				</div>
			)}
		</div>
	)
}
