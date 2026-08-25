import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import {materialSurfaceClasses} from '@/components/ui/shared/material'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// The dark glass surface itself, shared with hand-positioned tooltips (e.g. the
// dock, which anchors its own label so it tracks icon magnification).
export const darkTooltipClass = cn(
	materialSurfaceClasses.contextMenu,
	tw`relative isolate overflow-hidden rounded-full px-2.5 py-1 text-12 font-medium -tracking-2 whitespace-nowrap text-white`,
)

// Dark glass tooltip (originally from Machines). Wrap any focusable element:
// <DarkTooltip label="Restart"><button .../></DarkTooltip>
// Uses the Radix primitives directly (rather than components/ui/tooltip) so the
// content renders in a portal — otherwise ancestors with overflow-hidden clip it.
export function DarkTooltip({
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
					className={cn(
						darkTooltipClass,
						'z-50 animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
					)}
				>
					{label}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	)
}
