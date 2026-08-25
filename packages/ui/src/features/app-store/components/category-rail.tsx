import {compute} from 'compute-scroll-into-view'
import {motion, useReducedMotion} from 'motion/react'
import {useEffect, useId, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {NavLink, useParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {categoryIcon, categoryPath, DISCOVER_PATH} from '@/features/app-store/constants'
import {getCategoryLabel, getNavCategories} from '@/features/app-store/data/catalog'
import {useStorefront} from '@/features/app-store/hooks/use-storefront'
import {cn} from '@/lib/utils'
import {useAvailableApps} from '@/providers/available-apps'
import {tw} from '@/utils/tw'

// Horizontally scrollable, keyboard-accessible category rail. Lives in the
// store layout so the active pill morphs smoothly between routes.
export function CategoryRail() {
	const {categoryId} = useParams<{categoryId: string}>()
	const {appsGroupedByCategory} = useAvailableApps()
	const {isUnavailable} = useStorefront()

	// No category in the URL means we're on the Discover (index) route
	const activeId = categoryId ?? 'discover'
	// Discover already ends with the complete catalog, so the All apps pill
	// only earns its place when Discover is unavailable (where navigation also
	// defaults to it — see discover.tsx)
	const navIds = getNavCategories(appsGroupedByCategory ?? {}).filter((navId) => navId !== 'all' || isUnavailable)

	return <CategoryRailPills activeId={activeId} navIds={navIds} discoverUnavailable={isUnavailable} />
}

const pillClass = tw`relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-14 font-medium -tracking-2 whitespace-nowrap outline-hidden transition-colors duration-200`

function CategoryRailPills({
	activeId,
	navIds,
	discoverUnavailable,
}: {
	activeId: string
	navIds: string[]
	discoverUnavailable: boolean
}) {
	const {t} = useTranslation()
	const layoutId = useId()
	const reduceMotion = Boolean(useReducedMotion())
	const scrollerRef = useRef<HTMLDivElement>(null)
	const activeRef = useRef<HTMLAnchorElement>(null)

	// Keep the active pill in view. `scrollIntoView` would also scroll
	// `overflow: hidden` ancestors (the sheet), so compute within a boundary.
	useEffect(() => {
		if (!activeRef.current) return
		const actions = compute(activeRef.current, {
			scrollMode: 'if-needed',
			inline: 'center',
			boundary: scrollerRef.current,
		})
		actions.forEach(({el, top, left}) => {
			el.scrollTop = top
			el.scrollLeft = left
		})
	}, [activeId])

	return (
		<FadeScroller
			ref={scrollerRef}
			direction='x'
			className='umbrel-hide-scrollbar -mx-2.5 flex shrink-0 gap-1 overflow-x-auto px-2.5 py-1 md:mx-0 md:px-0'
		>
			{navIds.map((navId) => {
				const icon = categoryIcon(navId)
				const iconImg = icon && (
					<img src={icon} alt='' className='relative z-10 h-6 w-6 object-contain' draggable={false} />
				)

				// Discover is remote editorial content; without it the pill waits,
				// disabled, and navigation defaults to All apps instead
				if (navId === 'discover' && discoverUnavailable) {
					return (
						<DarkTooltip key={navId} label={t('app-store.discover-unavailable')} side='bottom'>
							<span
								aria-disabled
								className={cn(pillClass, 'cursor-not-allowed text-white/30 ring-1 ring-white/7 ring-inset')}
							>
								{iconImg && <span className='opacity-40'>{iconImg}</span>}
								<span className='relative z-10 pt-[1px]'>{getCategoryLabel(navId)}</span>
							</span>
						</DarkTooltip>
					)
				}

				const isActive = navId === activeId
				return (
					<NavLink
						key={navId}
						to={navId === 'discover' ? DISCOVER_PATH : categoryPath(navId)}
						end
						ref={isActive ? activeRef : undefined}
						aria-current={isActive ? 'page' : undefined}
						className={cn(
							pillClass,
							isActive
								? 'text-white'
								: // Inactive pills keep a whisper of an outline so the rail reads
									// as a row of controls, not floating labels
									'text-white/70 ring-1 ring-white/10 ring-inset hover:text-white hover:ring-white/16 focus-visible:text-white',
							'focus-visible:ring-2 focus-visible:ring-white/25',
						)}
					>
						{isActive && (
							<motion.span
								layoutId={reduceMotion ? undefined : layoutId}
								className='settings-edge-material absolute inset-0 rounded-full bg-white/10'
								transition={{type: 'spring', bounce: 0.2, duration: 0.4}}
							/>
						)}
						{iconImg}
						<span className='relative z-10 pt-[1px]'>{getCategoryLabel(navId)}</span>
					</NavLink>
				)
			})}
		</FadeScroller>
	)
}
