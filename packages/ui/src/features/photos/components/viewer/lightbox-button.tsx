import type {ComponentType} from 'react'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {machineRailButtonClass} from '@/features/machines/constants'
import {cn} from '@/lib/utils'

// The Machines console rail's control, reused as-is so the two feel like one system
export const lightboxButtonClass = machineRailButtonClass

export function LightboxButton({
	icon: Icon,
	label,
	active = false,
	side = 'bottom',
	className,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	icon: ComponentType<{className?: string}>
	label: string
	active?: boolean
	// Where the tooltip goes; the upload island sits at the screen's bottom
	// edge, so its tooltips point up instead
	side?: 'top' | 'bottom' | 'left' | 'right'
}) {
	return (
		<DarkTooltip label={label} side={side}>
			<button
				type='button'
				aria-label={label}
				aria-pressed={active || undefined}
				className={cn(lightboxButtonClass, active && 'bg-white/20 hover:bg-white/25', className)}
				{...props}
			>
				<Icon className='size-5' />
			</button>
		</DarkTooltip>
	)
}
