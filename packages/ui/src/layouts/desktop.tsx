import {useEffect} from 'react'

import {useCmdkOpen} from '@/components/cmdk'
import {AppSettingsDialogConnected} from '@/features/app-store/components/app-settings-dialog-connected'
import {StoreActionsProvider} from '@/features/app-store/providers/store-actions'
import {AppRequiresHttpsDialog} from '@/modules/app-store/app-page/app-requires-https-dialog'
import {DefaultCredentialsDialog} from '@/modules/app-store/app-page/default-credentials-dialog'
import {AppShareUsersDialog} from '@/modules/desktop/app-share-users-dialog'
import {DesktopContent} from '@/modules/desktop/desktop-content'
import {InstallFirstApp} from '@/modules/desktop/install-first-app'
import {DesktopWifiButtonConnected} from '@/modules/wifi/desktop-wifi-button-connected'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

export function Desktop() {
	const {userApps, isLoading} = useApps()

	// Members can't install apps, so they get the normal (empty) desktop rather
	// than the "install your first app" promo, which references app-store apps a
	// member's empty registry doesn't have. Wait for the role to be known before
	// deciding so a member never briefly renders the promo.
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'

	// Prefetch main dock route chunks on idle so they're instant on first click.
	// These are static JS files — no auth required to fetch them. Lives here
	// rather than in DesktopPage so the "install your first app" desktop, whose
	// next click is almost always the App Store, gets warmed too.
	useEffect(() => {
		if ('requestIdleCallback' in window) {
			const id = requestIdleCallback(prefetchRouteChunks)
			return () => cancelIdleCallback(id)
		}
		// Fallback for Safari (no requestIdleCallback): use a short timeout
		const id = setTimeout(prefetchRouteChunks, 200)
		return () => clearTimeout(id)
	}, [])

	if (isLoading || userQ.isLoading) {
		return null
	}

	if (userApps?.length === 0 && !isMember) {
		return <InstallFirstAppPage />
	}

	return <DesktopPage />
}

function InstallFirstAppPage() {
	return (
		<>
			<InstallFirstApp />
			<DesktopWifiButtonConnected className={topRightPositionerClass} />
		</>
	)
}

function prefetchRouteChunks() {
	import('@/features/app-store')
	import('@/features/app-store/components/discover')
	import('@/features/app-store/components/app-page')
	import('@/features/app-store/components/category')
	// The settings route itself is statically bundled; its content is the lazy chunk
	import('@/routes/settings/_components/settings-content')
	import('@/routes/settings/_components/settings-content-mobile')
	import('@/features/files')
	import('@/features/machines')
	import('@/features/machines/components/machines-index')
	import('@/routes/edit-widgets')
}

function DesktopPage() {
	const {setOpen} = useCmdkOpen()

	// Prevent scrolling on the desktop because it interferes with `AppGridGradientMasking` and causes tearing effect
	useEffect(() => {
		document.documentElement.style.overflow = 'hidden'
		return () => {
			document.documentElement.style.overflow = ''
		}
	}, [])

	return (
		<>
			<div
				className={
					// `relative` positioning keeps children above <Wallpaper /> since that element is positioned `fixed`
					'relative flex h-[100dvh] w-full flex-col items-center justify-between'
				}
			>
				<DesktopContent onSearchClick={() => setOpen(true)} />
				<DesktopWifiButtonConnected className={topRightPositionerClass} />
			</div>
			<DefaultCredentialsDialog />
			<StoreActionsProvider>
				<AppSettingsDialogConnected />
			</StoreActionsProvider>
			<AppShareUsersDialog />
			<AppRequiresHttpsDialog />
		</>
	)
}

const topRightPositionerClass = tw`absolute right-5 top-5 z-10`
