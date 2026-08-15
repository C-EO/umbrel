import * as TooltipPrimitive from '@radix-ui/react-tooltip'

// Dark glass tooltip matching the Machines look. Wrap any focusable element:
// <MachinesTooltip label="Restart"><button .../></MachinesTooltip>
// Uses the Radix primitives directly (rather than components/ui/tooltip) so the
// content renders in a portal — otherwise ancestors with overflow-hidden clip it.
export function MachinesTooltip({
	label,
	side = 'top',
	children,
}: {
	label: string
	side?: 'top' | 'bottom' | 'left' | 'right'
	children: React.ReactNode
}) {
	return (
		<TooltipPrimitive.Root delayDuration={250}>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					side={side}
					sideOffset={8}
					className='shadow-dropdown z-50 animate-in rounded-8 border-hpx border-white/10 bg-[#1e1e1e]/95 px-2.5 py-1.5 text-12 font-medium -tracking-2 whitespace-nowrap text-white/90 backdrop-blur-xl fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
				>
					{label}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	)
}
