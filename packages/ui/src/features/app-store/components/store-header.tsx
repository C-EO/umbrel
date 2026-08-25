import {motion, useTransform} from 'motion/react'
import {useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiCloseCircleFill} from 'react-icons/ri'
import {TbCircleArrowUp, TbDots, TbSearch} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {CategoryRail} from '@/features/app-store/components/category-rail'
import {UpdatesDialogConnected} from '@/features/app-store/components/updates-dialog'
import {storeRevealSoftClass} from '@/features/app-store/constants'
import {useStickyCollapse} from '@/features/app-store/hooks/use-sticky-collapse'
import type {useStoreSearch} from '@/features/app-store/hooks/use-store-search'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {CommunityAppStoreDialog} from '@/modules/app-store/community-app-store-dialog'
import {useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {useLinkToDialog} from '@/utils/dialog'

type StoreSearch = ReturnType<typeof useStoreSearch>

/**
 * The store's chrome: title, search, owner controls, and the category rail.
 * On desktop it pins to the top of the sheet and collapses with the scroll,
 * exactly like the app page hero: the title dissolves, search and the owner
 * controls settle onto the bar's centerline, and the category rail rises onto
 * the same line, shrinking to the space left beside them while staying
 * horizontally scrollable — then the blurred bar surface pops in underneath.
 */
export function StoreHeader({search, isOwner}: {search: StoreSearch; isOwner: boolean}) {
	const isMobile = useIsMobile()
	return isMobile ? (
		<MobileStoreHeader search={search} isOwner={isOwner} />
	) : (
		<DesktopStoreHeader search={search} isOwner={isOwner} />
	)
}

// Geometry of the collapse (px, desktop): title row, a gap, then the rail —
// all interpolating into one 64px bar (the same height as the app page hero
// bar, dictated by the sheet close button's centerline at 32px).
const TITLE_ROW = 36
const ROW_GAP = 20
const RAIL_HEIGHT = 44 // h-9 pills + the rail's own py-1
const HEADER_HEIGHT = TITLE_ROW + ROW_GAP + RAIL_HEIGHT
const BAR_HEIGHT = 64
const COLLAPSE_DISTANCE = 90 // scroll depth that scrubs the collapse

function DesktopStoreHeader({search, isOwner}: {search: StoreSearch; isOwner: boolean}) {
	const {t} = useTranslation()
	const {scrollRef} = useSheetStickyHeader()

	// 0 = full header, 1 = fully collapsed bar
	const wrapperRef = useRef<HTMLDivElement>(null)
	const progress = useStickyCollapse(wrapperRef, COLLAPSE_DISTANCE)

	// The rail shrinks to the space left beside the controls, so their width
	// (which varies with owner chips and the updates badge) is measured live
	const clusterRef = useRef<HTMLDivElement>(null)
	const [clusterWidth, setClusterWidth] = useState(300)
	useLayoutEffect(() => {
		const cluster = clusterRef.current
		if (!cluster) return
		const measure = () => setClusterWidth(cluster.getBoundingClientRect().width)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(cluster)
		return () => observer.disconnect()
	}, [])

	// The title dissolves early with a whisper of drift
	const titleOpacity = useTransform(progress, [0, 0.45], [1, 0])
	const titleY = useTransform(progress, [0, 1], [0, -8])
	// Search and the owner controls settle onto the bar's centerline
	const clusterY = useTransform(progress, [0, 1], [0, (BAR_HEIGHT - 36) / 2])
	// The rail rises onto the same line, its right edge pulling in to leave
	// room for the controls
	const railY = useTransform(progress, [0, 1], [TITLE_ROW + ROW_GAP, (BAR_HEIGHT - RAIL_HEIGHT) / 2])
	const railRight = useTransform(progress, [0, 1], [0, clusterWidth + 16])
	// The bar surface pops in only once everything is in its final position;
	// while visible, clicking its empty area scrolls back to the top
	const surfaceOpacity = useTransform(progress, [0.9, 1], [0, 1])
	const surfacePointerEvents = useTransform(progress, (p) => (p > 0.999 ? 'auto' : 'none'))

	// While searching the rail hides and the header is just the title row
	const showRail = !search.deferredQuery
	const headerHeight = showRail ? HEADER_HEIGHT : TITLE_ROW

	return (
		<div
			ref={wrapperRef}
			data-sticky-chrome
			className={cn('pointer-events-none sticky top-0 z-40', storeRevealSoftClass)}
			style={{height: headerHeight}}
		>
			{/* The solid bar surface, bleeding through the sheet's padding to
			    its edges — pops in once the collapse completes (see app-hero.tsx
			    for why it isn't frosted) */}
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
			<motion.div style={{opacity: titleOpacity, y: titleY}} className='absolute top-0 left-0'>
				{/* lg:text-36 matches the Settings sheet title */}
				<SheetTitle className='leading-none whitespace-nowrap lg:text-36'>{t('app-store.title')}</SheetTitle>
			</motion.div>
			<motion.div
				ref={clusterRef}
				style={{y: clusterY}}
				className='pointer-events-auto absolute top-0 right-0 flex items-center gap-2'
			>
				<StoreSearchInput inputRef={search.inputRef} value={search.query} onValueChange={search.setQuery} />
				{isOwner && <UpdatesChip />}
				{isOwner && <CommunityAppsMenu />}
			</motion.div>
			{showRail && (
				<motion.div style={{y: railY, right: railRight}} className='pointer-events-auto absolute left-0'>
					<CategoryRail />
				</motion.div>
			)}
		</div>
	)
}

function MobileStoreHeader({search, isOwner}: {search: StoreSearch; isOwner: boolean}) {
	const {t} = useTranslation()
	return (
		<SheetHeader className={cn('gap-4', storeRevealSoftClass)}>
			<div className='flex flex-wrap items-center gap-x-3 gap-y-3 px-2.5'>
				<SheetTitle className='leading-none whitespace-nowrap'>{t('app-store.title')}</SheetTitle>
				<div className='flex min-w-0 flex-1 items-center justify-end gap-2'>
					<StoreSearchInput inputRef={search.inputRef} value={search.query} onValueChange={search.setQuery} />
					{isOwner && <UpdatesChip />}
					{isOwner && <CommunityAppsMenu />}
				</div>
			</div>
			{!search.deferredQuery && <CategoryRail />}
		</SheetHeader>
	)
}

function StoreSearchInput({
	value,
	onValueChange,
	inputRef,
}: {
	value: string
	onValueChange: (query: string) => void
	inputRef?: React.Ref<HTMLInputElement>
}) {
	const {t} = useTranslation()
	return (
		<div
			className={cn(
				'settings-edge-material flex h-9 w-full max-w-[200px] min-w-0 shrink items-center gap-2 rounded-full bg-white/3 px-3 text-white/55 transition-colors duration-200',
				'focus-within:bg-white/7 focus-within:text-white/80 hover:bg-white/6',
			)}
		>
			<TbSearch className='h-4 w-4 shrink-0 opacity-70' />
			<input
				ref={inputRef}
				className='min-w-0 flex-1 bg-transparent text-13 text-white outline-hidden placeholder:text-white/35'
				placeholder={t('app-store.search-apps')}
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
				// Two-stage Escape: first clears the query, second blurs the input
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						if (value) {
							onValueChange('')
							e.preventDefault()
						} else {
							e.currentTarget.blur()
							e.preventDefault()
						}
					}
				}}
			/>
			{value && (
				<button
					aria-label={t('app-store.search.clear')}
					// Keep focus in the input so clearing doesn't end the search session
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => onValueChange('')}
					className='shrink-0 opacity-50 outline-hidden transition-opacity hover:opacity-90 focus-visible:opacity-90'
				>
					<RiCloseCircleFill className='h-4 w-4' />
				</button>
			)}
		</div>
	)
}

// Compact global shortcut to the updates dialog. The prominent updates shelf
// on Discover is the primary surface; this chip keeps updates reachable from
// category pages and search too.
function UpdatesChip() {
	const {t} = useTranslation()
	const linkToDialog = useLinkToDialog()
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()

	if (isLoading || appsWithUpdates.length === 0) {
		// Keep the dialog mounted so ?dialog=updates deep links keep working
		return <UpdatesDialogConnected />
	}

	return (
		<>
			<Link
				to={linkToDialog('updates')}
				aria-label={t('app-updates.updates-available-count', {count: appsWithUpdates.length})}
				className='settings-edge-material relative flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/3 px-3 text-13 font-medium text-white/70 outline-hidden transition-colors duration-200 hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-white/25'
			>
				<TbCircleArrowUp className='h-4 w-4' />
				<span className='max-md:hidden'>{t('app-store.updates')}</span>
				<NotificationBadge count={appsWithUpdates.length} />
			</Link>
			<UpdatesDialogConnected />
		</>
	)
}

function CommunityAppsMenu() {
	const {t} = useTranslation()
	const {addLinkSearchParams} = useQueryParams()
	return (
		<>
			<DropdownMenu>
				{/* tabIndex={-1} because we want the user to be able to tab straight to results */}
				<DropdownMenuTrigger
					tabIndex={-1}
					className='settings-edge-material flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/3 text-white/70 transition-colors duration-200 hover:bg-white/6 hover:text-white'
					aria-label={t('app-store.menu.community-app-stores')}
				>
					<TbDots className='h-4.5 w-4.5' />
				</DropdownMenuTrigger>
				{/* p-1 matches the tight context-menu surface */}
				<DropdownMenuContent className='p-1' align='end'>
					<DropdownMenuItem asChild>
						<Link to={{search: addLinkSearchParams({dialog: 'add-community-store'})}}>
							{t('app-store.menu.community-app-stores')}
						</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<CommunityAppStoreDialog />
		</>
	)
}
