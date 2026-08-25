import {motion, useTransform} from 'motion/react'
import {ReactNode, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCircleArrowLeftFilled} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {storeRevealDelay, storeRevealSoftClass} from '@/features/app-store/constants'
import {useStickyCollapse} from '@/features/app-store/hooks/use-sticky-collapse'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {SheetFixedContent} from '@/modules/sheet-top-fixed'
import {useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {RegistryApp} from '@/trpc/trpc'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'

type HeroProps = {app: RegistryApp; childrenRight: ReactNode}

export function AppPageHero({app, childrenRight}: HeroProps) {
	const isMobile = useIsMobile()
	return (
		<>
			<SheetBackButton />
			{isMobile ? (
				<MobileAppHero app={app} childrenRight={childrenRight} />
			) : (
				<DesktopAppHero app={app} childrenRight={childrenRight} />
			)}
		</>
	)
}

// The floating back button: a mirror of the sheet's close button
// (layouts/sheet.tsx and dialog-close-button.tsx — keep the insets and icon
// size in sync) portaled into the sheet's fixed layer, so it sits in the
// corner at every scroll position, including over the collapsed desktop bar
function SheetBackButton() {
	const {t} = useTranslation()
	const handleBack = useBackNavigation()
	return (
		<SheetFixedContent>
			<button
				className={cn(dialogHeaderCircleButtonClass, 'absolute top-3 left-3 z-60 sm:top-5 sm:left-5')}
				onClick={handleBack}
				aria-label={t('back')}
			>
				<TbCircleArrowLeftFilled className='h-5 w-5 lg:h-6 lg:w-6' />
			</button>
		</SheetFixedContent>
	)
}

// ---------------------------------------------------------------------------
// Desktop: scroll-collapsing hero
// ---------------------------------------------------------------------------

// The hero pins at the top of the sheet and collapses with the scroll: the
// icon and name scale down into their compact positions as you scroll (driven
// by the scroll position itself, not a time-based animation), the tagline and
// attribution dissolve, the action buttons stay put and settle into the bar,
// and once everything reaches its final size the blurred bar surface pops in
// underneath. Scrolling back up plays the exact same motion in reverse.

// Geometry of the collapse (px, desktop). The wrapper occupies the hero's
// natural height and stays sticky; everything inside is absolutely positioned
// and interpolated between its hero and bar placements. The bar's centerline
// is dictated by the sheet's corner buttons (top-5 + 24px icon = center 32px
// from the sheet corner): the bar is exactly twice that, so back button,
// icon, name, actions, and the cross all share one line. The back button
// lives in the corner permanently (SheetBackButton), so the hero starts right
// at the sheet's content padding with no row of its own above.
const HERO_HEIGHT = 120 // the hero row: the icon's height
const BAR_HEIGHT = 64
const BAR_CENTER = BAR_HEIGHT / 2
const COLLAPSE_DISTANCE = 90 // scroll depth that scrubs the collapse
const ICON_HERO = 120
const ICON_BAR = 36
// The corner buttons' inset from the sheet corner and their icon size
// (layouts/sheet.tsx: top-5 left/right-5; dialog-close-button.tsx: lg:h-6)
const CORNER_INSET = 20
const CORNER_BUTTON = 24

function DesktopAppHero({app, childrenRight}: HeroProps) {
	const {scrollRef} = useSheetStickyHeader()

	// 0 = full hero, 1 = fully collapsed bar. Clamped, so before the pin and
	// past the collapse it just rests at the endpoints.
	const wrapperRef = useRef<HTMLDivElement>(null)
	const progress = useStickyCollapse(wrapperRef, COLLAPSE_DISTANCE)

	// How far the sheet's content is padded from its edge, to know whether the
	// bar's icon would collide with the cornered back button
	const [contentInset, setContentInset] = useState(70)
	useLayoutEffect(() => {
		const measure = () => {
			const wrapper = wrapperRef.current
			const scroller = scrollRef?.current
			if (!wrapper || !scroller) return
			setContentInset(wrapper.getBoundingClientRect().left - scroller.getBoundingClientRect().left)
		}
		measure()
		window.addEventListener('resize', measure)
		return () => window.removeEventListener('resize', measure)
	}, [scrollRef])

	// Icon scales into the bar, landing on the content grid's left edge — unless
	// the sheet padding is too tight to clear the cornered back button, in which
	// case it shifts right just enough to keep a 12px gap after it
	const iconFinalX = Math.max(0, CORNER_INSET + CORNER_BUTTON + 12 - contentInset)
	const iconX = useTransform(progress, [0, 1], [0, iconFinalX])
	const iconY = useTransform(progress, [0, 1], [0, BAR_CENTER - ICON_BAR / 2])
	const iconScale = useTransform(progress, [0, 1], [1, ICON_BAR / ICON_HERO])
	// Radius grows pre-scale so the scaled-down icon lands on the bar's rounded-8
	const iconRadius = useTransform(progress, [0, 1], [30, 8 / (ICON_BAR / ICON_HERO)])
	// Name glides left and shrinks from text-32 to text-19, its cap-trimmed text
	// box landing centered on the bar's centerline next to the icon
	const nameX = useTransform(progress, [0, 1], [140, iconFinalX + ICON_BAR + 10])
	const nameY = useTransform(progress, [0, 1], [18, 25])
	const nameScale = useTransform(progress, [0, 1], [1, 19 / 32])
	// Tagline and attribution dissolve early in the collapse
	const metaOpacity = useTransform(progress, [0, 0.5], [1, 0])
	const metaY = useTransform(progress, [0, 1], [54, BAR_CENTER + 24])
	// The actions stay at the right and just settle into the bar
	const actionsY = useTransform(progress, [0, 1], [40, BAR_CENTER - 20])
	// The bar surface pops in only once everything is in its final position;
	// while visible, clicking its empty area scrolls back to the top
	const surfaceOpacity = useTransform(progress, [0.9, 1], [0, 1])
	const surfacePointerEvents = useTransform(progress, (p) => (p > 0.999 ? 'auto' : 'none'))

	return (
		<div
			ref={wrapperRef}
			data-sticky-chrome
			className='pointer-events-none sticky top-0 z-40'
			style={{height: HERO_HEIGHT}}
		>
			{/* The solid bar surface, bleeding through the sheet's padding to
			    its edges — pops in once the collapse completes. Deliberately not
			    frosted: Chromium can't sample this nested scroller for
			    backdrop-filter, so a clean black bar beats a broken blur. */}
			<motion.div
				aria-hidden
				style={{
					opacity: surfaceOpacity,
					pointerEvents: surfacePointerEvents,
					height: BAR_HEIGHT,
					boxShadow: '2px 2px 2px 0px #FFFFFF0D inset',
				}}
				onClick={() => scrollRef?.current?.scrollTo({top: 0, behavior: 'smooth'})}
				className='umbrel-window-surface-top absolute -inset-x-3 top-0 border-b border-white/10 bg-black md:-inset-x-[40px] xl:-inset-x-[70px]'
			/>
			{/* The motion wrappers own the scroll-driven transforms, so the entry
			    reveal (blur-and-fade only, never a transform) lives on their inner
			    elements — each a small beat after the last */}
			{/* The radius lives on the wrapper (so it can animate) and the icon
			    inherits it — rounding the image itself, rather than clipping it,
			    keeps the icon's 1px border intact along the curves */}
			<motion.div
				style={{x: iconX, y: iconY, scale: iconScale, borderRadius: iconRadius}}
				className='absolute top-0 left-0 origin-top-left'
			>
				<AppIcon
					src={app.icon}
					size={ICON_HERO}
					// Quieter edge than the default AppIcon border: at this size the
					// 10% line reads as a frame
					className={cn('rounded-[inherit] border-white/5', storeRevealSoftClass)}
					style={storeRevealDelay(40)}
				/>
			</motion.div>
			<motion.div
				style={{x: nameX, y: nameY, scale: nameScale}}
				className='absolute top-0 right-[300px] left-0 flex origin-top-left items-center'
			>
				<h1
					className={cn('min-w-0 truncate text-32 leading-inter-trimmed font-semibold', storeRevealSoftClass)}
					style={storeRevealDelay(90)}
				>
					{app.name}
				</h1>
			</motion.div>
			<motion.div style={{x: 140, y: metaY, opacity: metaOpacity}} className='absolute top-0 right-[300px] left-0'>
				<div className={cn('flex flex-col gap-1.5', storeRevealSoftClass)} style={storeRevealDelay(130)}>
					<p className='truncate text-15 leading-tight opacity-50'>{app.tagline}</p>
					<p className='truncate text-13 text-white/35'>{app.developer}</p>
				</div>
			</motion.div>
			<motion.div style={{y: actionsY}} className='pointer-events-auto absolute top-0 right-0'>
				<div className={cn('flex items-center gap-3 md:gap-4', storeRevealSoftClass)} style={storeRevealDelay(170)}>
					{childrenRight}
				</div>
			</motion.div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Mobile and tablet: simple hero (no sticky collapse)
// ---------------------------------------------------------------------------

// Phones (below sm) stack: a compact identity row, then the actions on their
// own full-width row (the install button stretches itself there — keep its
// breakpoint in sync, see install-button.tsx). Anything wider, up to the
// desktop hero at lg, has the room for a proper hero: larger icon and type
// with the actions inline on the right, like desktop minus the scroll collapse.

function MobileAppHero({app, childrenRight}: HeroProps) {
	return (
		<div className={cn('space-y-5', storeRevealSoftClass)}>
			<div
				data-testid='app-top'
				className='mt-5 flex flex-col items-stretch gap-5 sm:flex-row sm:items-center sm:gap-6'
			>
				<div className='flex min-w-0 flex-1 items-center gap-3 sm:gap-4'>
					{/* 64px on phones, 96px from sm — sized in CSS so the breakpoint
					    stays in step with the type; 25% corners like the desktop hero */}
					<AppIcon src={app.icon} className='size-16 rounded-15 border-white/5 sm:size-24 sm:rounded-24' />
					<div className='flex min-w-0 flex-col items-start gap-1 py-1 sm:gap-1.5'>
						<h1 className='text-16 leading-inter-trimmed font-semibold sm:text-24'>{app.name}</h1>
						<p className='line-clamp-2 w-full text-12 leading-tight opacity-50 sm:text-15'>{app.tagline}</p>
						<p className='hidden truncate text-13 text-white/35 sm:block'>{app.developer}</p>
					</div>
				</div>
				<div className='sm:shrink-0'>{childrenRight}</div>
			</div>
		</div>
	)
}

function useBackNavigation() {
	const navigate = useNavigate()
	const location = useLocation()

	return () => {
		if (location.state?.fromAppStore) {
			navigate(-1)
		} else {
			// Came from outside the app store (e.g. Files, home screen, deep link),
			// so navigate to the app store root instead of leaking into another section
			const isCommunity = location.pathname.startsWith('/community-app-store/')
			if (isCommunity) {
				const storeId = location.pathname.split('/')[2]
				navigate(`/community-app-store/${storeId}`)
			} else {
				navigate('/app-store')
			}
		}
	}
}
