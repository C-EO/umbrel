import React, {Suspense, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {Navigate, Route, Routes, useParams} from 'react-router-dom'
import {keys} from 'remeda'
import {arrayIncludes} from 'ts-extras'

import {Button} from '@/components/ui/button'
import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Loading} from '@/components/ui/loading'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {TwoFactorDialog} from '@/routes/settings/2fa'
import AdvancedSettingsDrawerOrDialog from '@/routes/settings/advanced'
import {SoftwareUpdateConfirmDialog} from '@/routes/settings/software-update-confirm'
import {trpcReact} from '@/trpc/trpc'
import {IS_ANDROID} from '@/utils/misc'

// import {SettingsContent} from './_components/settings-content'
const SettingsContent = React.lazy(() =>
	import('./_components/settings-content').then((m) => ({default: m.SettingsContent})),
)
const SettingsContentMobile = React.lazy(() =>
	import('./_components/settings-content-mobile').then((m) => ({default: m.SettingsContentMobile})),
)

const FileSharingDrawerOrDialog = React.lazy(() => import('@/routes/settings/file-sharing'))
const McpDialog = React.lazy(() => import('@/routes/settings/mcp'))
const AppStorePreferencesDialog = React.lazy(() => import('@/routes/settings/app-store-preferences'))
const ChangeNameDialog = React.lazy(() => import('@/routes/settings/change-name'))
const ChangePasswordDialog = React.lazy(() => import('@/routes/settings/change-password'))
const UsersDialog = React.lazy(() => import('@/routes/settings/users'))
const SessionsDialog = React.lazy(() => import('@/routes/settings/sessions'))
const RestartDialog = React.lazy(() => import('@/routes/settings/restart'))
const ShutdownDialog = React.lazy(() => import('@/routes/settings/shutdown'))
const TroubleshootDialog = React.lazy(() => import('@/routes/settings/troubleshoot/index'))
const TerminalDialog = React.lazy(() => import('@/routes/settings/terminal/index'))
const DeviceInfoDialog = React.lazy(() => import('@/routes/settings/device-info'))
const BackupsRestoreDialog = React.lazy(() => import('@/features/backups/index'))

// drawers
const StartMigrationDrawerOrDialog = React.lazy(() =>
	import('@/routes/settings/mobile/start-migration-drawer-or-dialog').then((m) => ({
		default: m.StartMigrationDrawerOrDialog,
	})),
)
const Wifi = React.lazy(() => import('@/routes/settings/wifi'))
const WifiUnsupported = React.lazy(() => import('@/routes/settings/wifi-unsupported'))
const AccountDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/account').then((m) => ({default: m.AccountDrawer})),
)
const WallpaperDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/wallpaper').then((m) => ({default: m.WallpaperDrawer})),
)
const LanguageDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/language').then((m) => ({default: m.LanguageDrawer})),
)
const AppStorePreferencesDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/app-store-preferences').then((m) => ({
		default: m.AppStorePreferencesDrawer,
	})),
)
const DeviceInfoDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/device-info').then((m) => ({default: m.DeviceInfoDrawer})),
)
const BackupsMobileDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/backups-mobile-drawer').then((m) => ({default: m.BackupsMobileDrawer})),
)
const SoftwareUpdateDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/software-update').then((m) => ({default: m.SoftwareUpdateDrawer})),
)
const StorageManagerDialog = React.lazy(() => import('@/features/storage/index'))

const routeToDialogDesktop = {
	'app-store-preferences': AppStorePreferencesDialog,
	restart: RestartDialog,
	shutdown: ShutdownDialog,
	// Allow drawers in desktop in case someone opens a link to a drawer
} as const satisfies Record<string, React.ComponentType>

const dialogKeys = keys.strict(routeToDialogDesktop)

export type SettingsDialogKey = keyof typeof routeToDialogDesktop

const routeToDialogMobile: Record<string, React.ComponentType> = {
	'app-store-preferences': AppStorePreferencesDrawer,
	restart: RestartDialog,
	shutdown: ShutdownDialog,
} as const satisfies Record<SettingsDialogKey, React.ComponentType>

function QueryStringDialog({isMember}: {isMember: boolean}) {
	const isMobile = useIsMobile() && !IS_ANDROID
	const routeToDialog = isMobile ? routeToDialogMobile : routeToDialogDesktop

	const {params} = useQueryParams()
	const dialog = params.get('dialog')

	// Prevent breaking if there's a dialog that is rendered somewhere else and not in this map ("logout", for example)
	const isRestrictedMemberAction = isMember && (dialog === 'restart' || dialog === 'shutdown')
	const has = dialog && !isRestrictedMemberAction && arrayIncludes(dialogKeys, dialog)
	// Early return rather than rendering a placeholder component: an inline
	// `() => null` would be a new component type each render, so React would
	// drop and recreate the fiber every time.
	if (!has || !dialog) return null

	const Component = routeToDialog[dialog]
	return <Component />
}

function OwnerAccountRedirect() {
	const {accountTab} = useParams<{accountTab: string}>()
	const panel = accountTab === 'change-password' ? 'password' : accountTab === 'sessions' ? 'sessions' : 'name'
	return <Navigate replace to={`/settings/users?ownerPanel=${panel}`} />
}

function OwnerSessionsRedirect() {
	return <Navigate replace to='/settings/users?ownerPanel=sessions' />
}

export function Settings() {
	const {t} = useTranslation()
	const title = t('settings')
	const isMobile = useIsMobile() && !IS_ANDROID

	// Wait for the role before mounting the settings content so role-restricted
	// queries and rows never flash while the current account is resolving.
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'

	return (
		<div className='contents lg:flex lg:h-full lg:min-h-0 lg:flex-col'>
			<SheetHeader className='px-2.5 lg:shrink-0 lg:px-0.5 lg:pt-12 lg:pb-5'>
				<SheetTitle className='leading-none lg:text-36'>{title}</SheetTitle>
			</SheetHeader>
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				{userQ.isLoading ? null : isMobile ? (
					<SettingsContentMobile isMember={isMember} />
				) : (
					<SettingsContent isMember={isMember} />
				)}
				<Suspense>
					{!userQ.isLoading && (
						<Routes>
							<Route path='/2fa' Component={TwoFactorDialog} />
							<Route path='/device-info' Component={isMobile ? DeviceInfoDrawer : DeviceInfoDialog} />
							{isMember && !isMobile && <Route path='/account/change-name' Component={ChangeNameDialog} />}
							{isMember && !isMobile && <Route path='/account/change-password' Component={ChangePasswordDialog} />}
							{!isMember && <Route path='/users' Component={UsersDialog} />}
							<Route path='/sessions' Component={isMember ? SessionsDialog : OwnerSessionsRedirect} />
							<Route path='/account/:accountTab' Component={isMember ? AccountDrawer : OwnerAccountRedirect} />
							{isMobile && <Route path='/wallpaper' Component={WallpaperDrawer} />}
							<Route path='/wifi' Component={Wifi} />
							<Route path='/wifi-unsupported' Component={WifiUnsupported} />
							{/* Backup: mobile drawer (/backups) opens first on mobile to give same options as desktop */}
							{isMobile && <Route path='/backups' Component={BackupsMobileDrawer} />}
							<Route path='/backups/*' Component={BackupsRestoreDialog} />
							{/* Not choosing based on `isMobile` because we don't want the dialog state to get reset if you resize the browser window. But also we want the same `/settings/migration-assistant` path for the first dialog/drawer you see */}
							<Route path='/migration-assistant' Component={StartMigrationDrawerOrDialog} />
							{isMobile && <Route path='/language' Component={LanguageDrawer} />}
							<Route path='/troubleshoot/*' Component={TroubleshootDialog} />
							<Route path='/terminal/*' Component={TerminalDialog} />
							{isMobile && <Route path='/software-update' Component={SoftwareUpdateDrawer} />}
							<Route path='/software-update/confirm' Component={SoftwareUpdateConfirmDialog} />
							<Route path='/file-sharing' Component={FileSharingDrawerOrDialog} />
							{!isMember && <Route path='/mcp' Component={McpDialog} />}
							<Route path='/advanced/:advancedSelection?' Component={AdvancedSettingsDrawerOrDialog} />
							<Route path='/storage/*' Component={StorageManagerDialog} />
						</Routes>
					)}
					{!userQ.isLoading && <QueryStringDialog isMember={isMember} />}
				</Suspense>
			</ErrorBoundary>
		</div>
	)
}

export function CoverTest() {
	const {t} = useTranslation()
	const [showCover, setShowCover] = useState(false)

	return (
		<>
			<Button onClick={() => setShowCover(true)}>Show cover</Button>
			{showCover && (
				<CoverMessage onClick={() => setShowCover(false)}>
					<Loading>{t('shut-down.shutting-down')}</Loading>
					<CoverMessageParagraph>{t('shut-down.shutting-down-message')}</CoverMessageParagraph>
				</CoverMessage>
			)}
		</>
	)
}
