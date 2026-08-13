import * as SonnerPrimitive from 'sonner'

import {AppIcon} from '@/components/app-icon'
import {materialSurfaceClasses} from '@/components/ui/shared/material'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {playNotificationSound} from '@/utils/notification-sound'
import {tw} from '@/utils/tw'

export function Toaster() {
	const isMobile = useIsMobile()
	return (
		<SonnerPrimitive.Toaster
			closeButton
			position='top-right'
			// Extra room on the right so the close button floating outside the
			// capsule (visible from sm) never clips against the viewport edge.
			// Below 600px sonner applies its own mobileOffset instead of this.
			offset={isMobile ? {top: 12, right: 40, bottom: 12, left: 12} : {top: 24, right: 40, bottom: 24, left: 24}}
			// Desktop only: sonner's mobile media query sets its own width
			style={{'--width': '356px'} as React.CSSProperties}
			className='group'
			toastOptions={{
				unstyled: true,
				classNames: {
					// Allow text selection for copying error messages
					toast: cn(
						materialSurfaceClasses.toast,
						tw`group/toast flex w-full items-center gap-2.5 px-3 py-3 text-14 -tracking-2 text-white select-text`,
					),
					content: tw`min-w-0 flex-1`,
					title: tw`leading-snug font-medium select-text`,
					description: tw`text-13 leading-snug text-white/45 select-text`,
					actionButton: tw`h-7 shrink-0 rounded-full bg-white/10 px-3 text-12 font-medium whitespace-nowrap transition-colors hover:bg-white/16`,
					cancelButton: tw`h-7 shrink-0 rounded-full px-3 text-12 font-medium whitespace-nowrap text-white/60 transition-colors hover:bg-white/10 hover:text-white`,
					// Floats just outside the capsule's right edge, revealed on hover;
					// swipe dismisses on touch
					closeButton: tw`absolute top-1/2 -right-7 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/70 opacity-0 backdrop-blur-sm transition-[opacity,background-color,color] group-hover/toast:opacity-100 hover:bg-black/50 hover:text-white focus-visible:opacity-100 sm:flex`,
				},
			}}
		/>
	)
}

// The product area a toast comes from, shown as that area's icon
const AREA_ICONS = {
	files: '/assets/dock/dock-files.png',
	settings: '/assets/dock/dock-settings.png',
	'app-store': '/assets/dock/dock-app-store.png',
	'live-usage': '/assets/dock/dock-live-usage.png',
	widgets: '/assets/dock/dock-widgets.png',
	umbrelos: '/assets/umbrel-ios.png',
} as const
export type ToastArea = keyof typeof AREA_ICONS

export type ToastOptions = SonnerPrimitive.ExternalToast & {
	/**
	 * Stretch the action button's hit area over the whole toast so tapping
	 * anywhere triggers it. Only for toasts with a single action — the overlay
	 * sits over the text, so it defeats text selection and any other inline
	 * control except the close button.
	 */
	fullClick?: boolean
	/** Show this area's icon instead of the status dot */
	area?: ToastArea
}

function resolveOptions(options: ToastOptions = {}): SonnerPrimitive.ExternalToast {
	const {fullClick, area, ...rest} = options
	// An explicit caller icon still wins over the area icon
	const opts = area ? {icon: <ToastSourceIcon src={AREA_ICONS[area]} />, ...rest} : rest
	if (!fullClick) return opts
	return {
		...opts,
		classNames: {
			...opts.classNames,
			actionButton: cn(
				tw`cursor-pointer after:absolute after:inset-0 after:content-[''] group-hover/toast:bg-white/16`,
				opts.classNames?.actionButton,
			),
			closeButton: cn(tw`z-10`, opts.classNames?.closeButton),
		},
	}
}

const toastFunction = (message: Parameters<typeof SonnerPrimitive.toast>[0], opts?: ToastOptions) => {
	playNotificationSound()
	return SonnerPrimitive.toast(message, resolveOptions(opts))
}

export const toast = Object.assign(toastFunction, {
	...SonnerPrimitive.toast,
	// The status dot is the default icon; callers can pass their own `icon`
	// (e.g. the source area's icon) to override it
	success: (message: string, opts?: ToastOptions) => {
		playNotificationSound()
		return SonnerPrimitive.toast.success(message, {
			icon: <ToastStatusDot hexColor='#00AD79' />,
			...resolveOptions(opts),
		})
	},
	info: (message: string, opts?: ToastOptions) => {
		playNotificationSound()
		return SonnerPrimitive.toast.info(message, {icon: <ToastStatusDot hexColor='#139EED' />, ...resolveOptions(opts)})
	},
	warning: (message: string, opts?: ToastOptions) => {
		playNotificationSound()
		return SonnerPrimitive.toast.warning(message, {
			icon: <ToastStatusDot hexColor='#D7BF44' />,
			...resolveOptions(opts),
		})
	},
	error: (message: string, opts?: ToastOptions) => {
		playNotificationSound()
		return SonnerPrimitive.toast.error(message, {
			icon: <ToastStatusDot hexColor='#F45A5A' pulse />,
			...resolveOptions(opts),
		})
	},
})

/** The icon of the area a toast comes from (Files, Settings, App Store, …) */
function ToastSourceIcon({src}: {src: string}) {
	return <AppIcon src={src} size={40} className='shrink-0 rounded-10 shadow-md' />
}

export function ToastStatusDot({hexColor, pulse}: {hexColor: string; pulse?: boolean}) {
	return (
		<span aria-hidden='true' className='flex size-4 shrink-0 items-center justify-center'>
			<span
				className={cn('size-[7px] rounded-full', pulse && 'animate-pulse')}
				style={{backgroundColor: hexColor, boxShadow: `0 0 0 3px ${hexColor}33`}}
			/>
		</span>
	)
}
