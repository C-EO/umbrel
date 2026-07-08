import {cva} from 'class-variance-authority'
import {useContext} from 'react'

import {Glass} from '@/components/ui/glass'
import {useTilt} from '@/components/ui/tilt'
import {cn} from '@/lib/utils'
import {useWallpaper} from '@/providers/wallpaper'
import {tw} from '@/utils/tw'

import {BackdropBlurVariantContext} from './backdrop-blur-context'

export const widgetContainerCva = cva(
	cn(
		tw`rounded-12 sm:rounded-20 w-[var(--widget-w,270px)] h-[var(--widget-h,150px)] shrink-0 flex flex-col gap-2 cursor-default text-left`,
		// animations
		tw`transition-[scale,box-shadow] duration-300 hover:scale-105`,
	),
	// ^-- Using `tw` to force vscode to recognize the tailwind classes
	{
		variants: {
			variant: {
				// bg and blur come from <Glass> (tint + backdrop-filter)
				'with-backdrop-blur': 'contrast-more:bg-neutral-900 shadow-widget-drop',
				default: 'bg-neutral-900/80 shadow-widget',
			},
		},
		defaultVariants: {
			variant: 'with-backdrop-blur',
		},
	},
)

export const widgetTextCva = cva('text-11 sm:text-13 leading-snug font-semibold -tracking-2 truncate', {
	variants: {
		opacity: {
			primary: 'opacity-80',
			secondary: 'opacity-50',
			tertiary: 'opacity-25',
		},
	},
})

type WidgetContainerButtonProps = React.ComponentPropsWithoutRef<'button'>
type WidgetContainerDivProps = React.ComponentPropsWithoutRef<'div'>
type WidgetContainerProps = WidgetContainerButtonProps | WidgetContainerDivProps

const widgetButtonClass = tw`ring-white/25 focus:outline-hidden focus-visible:ring-6 active:scale-95`

/** Make the widget a button if we pass an `onClick` */
export const WidgetContainer: React.FC<WidgetContainerProps> = ({className, ...props}) => {
	const variant = useContext(BackdropBlurVariantContext)
	const {wallpaperImgRef} = useWallpaper()
	// tvOS-style hover tilt — handlers spread onto the glass host below (mouse
	// only, respects reduced motion; drives transform without re-rendering)
	const tilt = useTilt()

	// The `default` variant is opaque (widget selector sheet) — no glass needed
	if (variant === 'default') {
		// Forcing the correct types for `props`
		// Only allow `onClick` to do something if it's truthy
		if ('onClick' in props) {
			const p = props as WidgetContainerButtonProps
			return <button className={cn(widgetContainerCva({variant}), widgetButtonClass, className)} {...p} />
		} else {
			const p = props as WidgetContainerDivProps
			return <div className={cn(widgetContainerCva({variant}), className)} {...p} />
		}
	}

	const interactive = 'onClick' in props
	return (
		<Glass
			as={interactive ? 'button' : 'div'}
			tint='rgb(23 23 23 / 0.1)'
			refractionTarget={wallpaperImgRef}
			className={cn(widgetContainerCva({variant}), interactive && widgetButtonClass, className)}
			{...(props as React.HTMLAttributes<HTMLElement>)}
			{...tilt}
		/>
	)
}
