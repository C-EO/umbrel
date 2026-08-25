import prettyBytes from 'pretty-bytes'
import {useImperativeHandle, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {arrayIncludes} from 'ts-extras'

import {Button} from '@/components/ui/button'
import {toast} from '@/components/ui/toast'
import {useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useUpdateApp} from '@/hooks/use-update-app'
import {getDependencyAlternatives} from '@/modules/app-store/dependency-alternatives'
import {OSUpdateRequiredDialog} from '@/modules/app-store/os-update-required'
import {SelectDependenciesDialog} from '@/modules/app-store/select-dependencies-dialog'
import {canPresentUpdateAction, isAppUpdateAvailable} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {installedStates, RegistryApp, trpcReact} from '@/trpc/trpc'

import {InstallButton} from './install-button'

export function InstallButtonConnected({app, ref}: {app: RegistryApp; ref?: React.Ref<unknown>}) {
	const {t} = useTranslation()
	const appInstall = useAppInstall(app.id)
	// Members browse the app store read-only, only the owner can install
	const isMember = trpcReact.user.get.useQuery().data?.role === 'member'
	const {apps, ambiguousAppIds} = useAllAvailableApps()
	const [showDepsDialog, setShowDepsDialog] = useState(false)
	const [showOSUpdateRequiredDialog, setShowOSUpdateRequiredDialog] = useState(false)
	const {userAppsKeyed, isLoading} = useApps()
	const openApp = useLaunchApp()
	const updateApp = useUpdateApp(app.id)
	const [selections, setSelections] = useState({} as Record<string, string>)
	const [highlightDependency, setHighlightDependency] = useState<string | undefined>(undefined)

	useImperativeHandle(ref, () => ({
		triggerInstall(highlightDependency?: string) {
			setHighlightDependency(highlightDependency)
			triggerInstall()
		},
	}))

	if (isLoading || !userAppsKeyed || !apps || !ambiguousAppIds) {
		return (
			<InstallButton
				key={app.id}
				installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
				progress={appInstall.progress}
				state='loading'
			/>
		)
	}

	const isInstalled = (appId: string) => arrayIncludes(installedStates, userAppsKeyed[appId]?.state)

	const selectAlternative = (dependencyId: string, appId: string | undefined) => {
		if (appId) selections[dependencyId] = appId
		else delete selections[dependencyId]
		setSelections({...selections})
	}

	const isAppIdAmbiguous = ambiguousAppIds.has(app.id)
	const dependencies = getDependencyAlternatives(app.dependencies, apps, userAppsKeyed, ambiguousAppIds)

	// Auto-select the first installed alternative, naturally preferring the original
	// app when it is installed as well.
	dependencies.forEach(({dependencyId, appIds}) => {
		appIds.forEach((appId) => {
			if (!selections[dependencyId] && isInstalled(appId)) {
				selectAlternative(dependencyId, appId)
			}
		})
	})

	// TODO: Also check if app is ready? `&& userAppsKeyed[dep].state === 'ready'`
	// Will want to mark apps as in progress so we don't show that an app needs to be installed first
	const areAllAlternativesSelectedAndInstalled = dependencies.every(({dependencyId, appIds}) =>
		appIds.some((appId) => selections[dependencyId] === appId && isInstalled(appId)),
	)

	const install = () => {
		if (isMember) {
			toast(t('app-store.ask-owner-to-install'), {area: 'app-store'})
			return
		}
		if (isAppIdAmbiguous) {
			toast(t('app-store.app-id-conflict'), {area: 'app-store'})
			return
		}
		if (!app.compatible) {
			setShowOSUpdateRequiredDialog(true)
			return
		}
		if (dependencies.length > 0) {
			return setShowDepsDialog(true)
		}
		appInstall.install()
	}

	function triggerInstall() {
		install()
	}

	const verifyInstall = (selectedDeps: Record<string, string>) => {
		if (isAppIdAmbiguous) return
		// Currently always the case because AppPermissionsDialog checks
		if (areAllAlternativesSelectedAndInstalled) {
			appInstall.install(selectedDeps)
		}
	}

	// Open remains the primary installed-app action. Updates are offered
	// separately so an incompatible update never blocks launching the app.
	const userApp = userAppsKeyed[app.id]
	const updateAvailable = !isMember && !!userApp && isAppUpdateAvailable(userApp.version, app)
	const canOfferUpdate = updateAvailable && canPresentUpdateAction(appInstall.state)

	const update = () => {
		if (isAppIdAmbiguous) {
			toast(t('app-store.app-id-conflict'), {area: 'app-store'})
			return
		}
		if (!canPresentUpdateAction(appInstall.state)) return
		if (!app.compatible) {
			setShowOSUpdateRequiredDialog(true)
			return
		}
		updateApp.update()
	}

	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex items-center gap-3 max-sm:flex-col max-sm:items-stretch md:gap-4'>
				<InstallButton
					// `key` to prevent framer-motion from thinking install buttons from different pages are the same and animating between them
					key={app.id}
					installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
					// progress={userApp?.installProgress}
					// state={userApp?.state || 'initial'}
					progress={appInstall.progress}
					state={appInstall.state}
					onInstallClick={install}
					onOpenClick={() => openApp(app.id)}
					disabled={isAppIdAmbiguous && appInstall.state === 'not-installed'}
				/>
				{canOfferUpdate && (
					<Button
						size='lg'
						onClick={update}
						disabled={isAppIdAmbiguous || updateApp.isPending}
						className='max-sm:h-[30px] max-sm:w-full max-sm:text-13'
					>
						{t('app-updates.update')}
					</Button>
				)}
			</div>
			{isAppIdAmbiguous && (
				<p className='max-w-64 text-right text-11 leading-tight text-amber-200/70 max-sm:text-center'>
					{t('app-store.app-id-conflict')}
				</p>
			)}
			<SelectDependenciesDialog
				appId={app.id}
				dependencies={dependencies}
				open={showDepsDialog}
				onOpenChange={setShowDepsDialog}
				onNext={verifyInstall}
				highlightDependency={highlightDependency}
			/>
			<OSUpdateRequiredDialog
				app={app}
				open={showOSUpdateRequiredDialog}
				onOpenChange={setShowOSUpdateRequiredDialog}
			/>
		</div>
	)
}
