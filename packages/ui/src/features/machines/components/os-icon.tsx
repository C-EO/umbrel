import {Disc3} from 'lucide-react'

import {getOsVisuals} from '@/features/machines/constants'
import {cn} from '@/lib/utils'

// Renders the logo for a popular OS, or a generic disc for custom ISOs.
// Size it via className (e.g. `size-12`).
export function OsIcon({osId, className}: {osId: string; className?: string}) {
	const visuals = getOsVisuals(osId)

	if (!visuals.logo) {
		return (
			<div
				className={cn(
					'grid shrink-0 place-items-center rounded-full border border-white/15 bg-linear-to-b from-[#494949] to-[#1e1e1e]',
					className,
				)}
			>
				<Disc3 className='size-[62%] text-white/80' strokeWidth={1.5} />
			</div>
		)
	}

	if (visuals.circleBackground) {
		return (
			<div
				className={cn(
					'grid shrink-0 place-items-center rounded-full border border-white/15 bg-linear-to-b from-[#494949] to-[#1e1e1e]',
					className,
				)}
			>
				<img src={visuals.logo} alt='' className='size-[62%] object-contain' draggable={false} />
			</div>
		)
	}

	return <img src={visuals.logo} alt='' className={cn('shrink-0 object-contain', className)} draggable={false} />
}

// A soft blurred color glow to place behind an OS icon (matches the Figma
// treatment where each OS card has a blurred copy of the logo behind it)
export function OsIconGlow({osId, className}: {osId: string; className?: string}) {
	const visuals = getOsVisuals(osId)

	return (
		<div
			aria-hidden
			className={cn('pointer-events-none absolute rounded-full opacity-50 blur-2xl', className)}
			style={{backgroundColor: visuals.color}}
		/>
	)
}
