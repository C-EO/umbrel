import type {LucideIcon} from 'lucide-react'
import {motion, useReducedMotion} from 'motion/react'

// A feature pitch said in three glances: icon, promise, one-line explanation.
// Shared by the cloud and MCP intros so first-run screens read the same way
// across the product.

export type PitchPoint = {
	icon: LucideIcon
	title: string
	description: string
}

export function PitchPoints({points, delay = 0.1}: {points: PitchPoint[]; delay?: number}) {
	const reducedMotion = useReducedMotion() ?? false
	return (
		<div className='mx-auto flex w-full max-w-[360px] flex-col gap-2 text-left'>
			{points.map(({icon: Icon, title, description}, index) => (
				<motion.div
					key={title}
					initial={reducedMotion ? false : {opacity: 0, y: 4}}
					animate={{opacity: 1, y: 0}}
					transition={{duration: 0.4, delay: delay + index * 0.08}}
					className='flex items-start gap-3 rounded-xl bg-white/5 px-3.5 py-3'
				>
					<Icon className='mt-0.5 size-[18px] shrink-0 text-brand-lighter' />
					<div className='min-w-0'>
						<p className='text-13 font-medium'>{title}</p>
						<p className='text-12 leading-relaxed text-white/50'>{description}</p>
					</div>
				</motion.div>
			))}
		</div>
	)
}
