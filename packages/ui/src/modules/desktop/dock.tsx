import {motion, useMotionValue} from 'motion/react'
import React, {Suspense} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useLocation, useNavigate} from 'react-router-dom'
import {useMedia} from 'react-use'

import {Glass} from '@/components/ui/glass'
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {useSettingsNotificationCount} from '@/hooks/use-settings-notification-count'
import {cn} from '@/lib/utils'
import {systemAppsKeyed} from '@/providers/apps'
import {useWallpaper} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

import {DockItem} from './dock-item'
import {LogoutDialog} from './logout-dialog'

const LiveUsageDialog = React.lazy(() => import('@/routes/live-usage'))
const WhatsNewModal = React.lazy(() => import('@/routes/whats-new-modal').then((m) => ({default: m.WhatsNewModal})))

const DOCK_BOTTOM_PADDING_PX = 10
const SHOW_DOCK_UTILITIES_QUERY = '(min-width: 496px)'

const DOCK_DIMENSIONS_PX = {
	preview: {
		iconSize: 50,
		iconSizeZoomed: 80,
		padding: 12,
	},
	desktop: {
		iconSize: 50,
		iconSizeZoomed: 80,
		padding: 12,
	},
	mobile: {
		iconSize: 48,
		iconSizeZoomed: 60,
		padding: 8,
	},
} as const

type DockDimensionsPx = {
	iconSize: number
	iconSizeZoomed: number
	padding: number
	dockHeight: number
}

function useDockDimensions(options?: {isPreview?: boolean}): DockDimensionsPx {
	const isMobile = useIsMobile()

	if (options?.isPreview) {
		const {iconSize, iconSizeZoomed, padding} = DOCK_DIMENSIONS_PX.preview
		return {iconSize, iconSizeZoomed, padding, dockHeight: iconSize + padding * 2}
	}

	const dimensions = isMobile ? DOCK_DIMENSIONS_PX.mobile : DOCK_DIMENSIONS_PX.desktop
	const {iconSize, iconSizeZoomed, padding} = dimensions
	return {iconSize, iconSizeZoomed, padding, dockHeight: iconSize + padding * 2}
}

export function Dock() {
	const {pathname} = useLocation()
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const mouseX = useMotionValue(Infinity)
	const settingsNotificationCount = useSettingsNotificationCount()
	const {appsWithUpdates} = useAppsWithUpdates()
	const isMobile = useIsMobile()
	const showDockUtilities = useMedia(SHOW_DOCK_UTILITIES_QUERY)
	const {iconSize, iconSizeZoomed, padding, dockHeight} = useDockDimensions()
	const {wallpaperImgRef} = useWallpaper()

	// Members browse the app store read-only, updates are owner-only
	const {data: user} = trpcReact.user.get.useQuery()
	const isMember = user?.role === 'member'
	const isOwner = user?.role === 'owner'

	const appUpdateCount = appsWithUpdates.length

	// Read sessionStorage at click time, not render time, because React Compiler
	// may cache the render-time read and return a stale value.
	const navigateToLastFilesPath = (e: React.MouseEvent) => {
		e.preventDefault()
		const lastFilesPath = getLastFilesPath(user?.userId)
		navigate(lastFilesPath || systemAppsKeyed['UMBREL_files'].systemAppTo)
	}

	return (
		<>
			<motion.div
				initial={{translateY: 80, opacity: 0}}
				animate={{translateY: 0, opacity: 1}}
				transition={{type: 'spring', stiffness: 200, damping: 20, delay: 0.2, duration: 0.2}}
				onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.pageX)}
				onPointerLeave={() => mouseX.set(Infinity)}
				className='shrink-0 transform-gpu will-change-transform'
			>
				<Glass
					{...dockGlassProps}
					// Only on the bare desktop: the WebGL fallback lens sees just the
					// wallpaper, and on other routes page content scrolls under the dock
					refractionTarget={pathname === '/' ? wallpaperImgRef : undefined}
					className={cn(dockClass, isMobile && 'gap-2')}
					style={{
						height: dockHeight,
						paddingBottom: padding,
					}}
				>
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_files'].systemAppTo}
						onClick={navigateToLastFilesPath}
						open={pathname.startsWith('/files')}
						bg={systemAppsKeyed['UMBREL_files'].icon}
						label={systemAppsKeyed['UMBREL_files'].name}
						mouseX={mouseX}
					/>
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_app-store'].systemAppTo}
						open={pathname.startsWith(systemAppsKeyed['UMBREL_app-store'].systemAppTo)}
						bg={systemAppsKeyed['UMBREL_app-store'].icon}
						label={systemAppsKeyed['UMBREL_app-store'].name}
						notificationCount={isMember ? undefined : appUpdateCount}
						mouseX={mouseX}
					/>
					{isOwner && (
						<DockItem
							iconSize={iconSize}
							iconSizeZoomed={iconSizeZoomed}
							to={systemAppsKeyed['UMBREL_machines'].systemAppTo}
							open={pathname.startsWith(systemAppsKeyed['UMBREL_machines'].systemAppTo)}
							bg={systemAppsKeyed['UMBREL_machines'].icon}
							label={systemAppsKeyed['UMBREL_machines'].name}
							mouseX={mouseX}
						/>
					)}
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_settings'].systemAppTo}
						open={pathname.startsWith(systemAppsKeyed['UMBREL_settings'].systemAppTo)}
						bg={systemAppsKeyed['UMBREL_settings'].icon}
						label={systemAppsKeyed['UMBREL_settings'].name}
						notificationCount={settingsNotificationCount}
						mouseX={mouseX}
					/>
					{showDockUtilities && (
						<DockItem
							iconSize={iconSize}
							iconSizeZoomed={iconSizeZoomed}
							to={{search: addLinkSearchParams({dialog: 'live-usage'})}}
							open={pathname.startsWith(systemAppsKeyed['UMBREL_live-usage'].systemAppTo)}
							bg={systemAppsKeyed['UMBREL_live-usage'].icon}
							label={systemAppsKeyed['UMBREL_live-usage'].name}
							mouseX={mouseX}
						/>
					)}
				</Glass>
			</motion.div>
			<LogoutDialog />

			<ErrorBoundary fallbackRender={() => null}>
				<Suspense>
					<LiveUsageDialog />
				</Suspense>
			</ErrorBoundary>
			<ErrorBoundary fallbackRender={() => null}>
				<Suspense>
					<WhatsNewModal />
				</Suspense>
			</ErrorBoundary>
		</>
	)
}

export function DockPreview() {
	const mouseX = useMotionValue(Infinity)
	const {iconSize, iconSizeZoomed, padding, dockHeight} = useDockDimensions({isPreview: true})

	return (
		<Glass
			{...dockGlassProps}
			className={dockPreviewClass}
			style={{
				height: dockHeight,
				paddingBottom: padding,
			}}
		>
			<DockItem
				bg={systemAppsKeyed['UMBREL_files'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_app-store'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_machines'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_settings'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_live-usage'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
		</Glass>
	)
}

export function DockSpacer({className}: {className?: string}) {
	const {dockHeight} = useDockDimensions()
	return <div className={cn('w-full shrink-0', className)} style={{height: dockHeight + DOCK_BOTTOM_PADDING_PX}} />
}

export function DockBottomPositioner({children}: {children: React.ReactNode}) {
	return (
		<div className='fixed bottom-0 left-1/2 z-50 -translate-x-1/2' style={{paddingBottom: DOCK_BOTTOM_PADDING_PX}}>
			{children}
		</div>
	)
}

// Clearer glass than the widget defaults: barely any blur or tint, hard refraction
const dockGlassProps = {blur: 1.5, saturate: 1.4, brightness: 0.9, scale: 70, chroma: 0.24, bevel: 1.0} as const

const dockClass = tw`mx-auto flex items-end gap-2.5 rounded-2xl contrast-more:bg-neutral-700 px-3 shadow-dock-drop shrink-0`
const dockPreviewClass = tw`mx-auto flex items-end gap-4 rounded-2xl px-3 shadow-dock-drop shrink-0`
