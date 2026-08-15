import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import {cn} from '@/lib/utils'

function Slider({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
	ref?: React.Ref<React.ComponentRef<typeof SliderPrimitive.Root>>
}) {
	return (
		<SliderPrimitive.Root
			ref={ref}
			className={cn('relative flex w-full touch-none items-center select-none disabled:opacity-50', className)}
			{...props}
		>
			<SliderPrimitive.Track className='relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/10'>
				<SliderPrimitive.Range className='absolute h-full rounded-full bg-white' />
			</SliderPrimitive.Track>
			<SliderPrimitive.Thumb className='block size-4 rounded-full bg-white shadow-lg transition-transform focus-visible:ring-3 focus-visible:ring-white/20 focus-visible:outline-hidden active:scale-110 disabled:pointer-events-none' />
		</SliderPrimitive.Root>
	)
}

export {Slider}
