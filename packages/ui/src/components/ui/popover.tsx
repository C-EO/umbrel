import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

import {cn} from '@/lib/utils'

import {floatingContentAnimationClass, materialSurfaceClasses} from './shared/material'

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverClose = PopoverPrimitive.Close

function PopoverContent({
	className,
	ref,
	align = 'center',
	sideOffset = 4,
	...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof PopoverPrimitive.Content>>
}) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				className={cn(
					materialSurfaceClasses.popover,
					floatingContentAnimationClass,
					'z-50 min-w-[8rem] p-1 text-white',
					className,
				)}
				{...props}
				// Prevent right-clicks within content from triggering parent context menus
				onContextMenu={(e) => {
					e.preventDefault() // Prevent default browser context menu
					e.stopPropagation()
				}}
			/>
		</PopoverPrimitive.Portal>
	)
}

export {Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose}
