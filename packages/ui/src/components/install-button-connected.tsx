import prettyBytes from 'pretty-bytes'
import {createContext, useContext, useImperativeHandle, useRef, useState} from 'react'
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

export type InstallButtonConnectedHandle = {
	triggerInstall: (highlightDependency?: string) => void
}

type LoadingController = {
	status: 'loading'
	app: RegistryApp
	installSize: string | undefined
	progress: number | undefined
}

type ReadyController = {
	status: 'ready'
	app: RegistryApp
	installSize: string | undefined
	progress: number | undefined
	installState: ReturnType<typeof useAppInstall>['state']
	install: () => void
	open: () => void
	update: () => void
	updatePending: boolean
	canOfferUpdate: boolean
	isAppIdAmbiguous: boolean
}

type InstallController = LoadingController | ReadyController
const InstallButtonControllerContext = createContext<InstallController | null>(null)

/**
 * Owns install/update/dependency state once while allowing the expanded hero
 * and compact toolbar to render native-sized action controls from that same
 * controller. Dialogs also live here, so duplicated visual triggers never
 * create independent flows.
 */
export function InstallButtonConnectedController({
	app,
	children,
	ref,
}: {
	app: RegistryApp
	children: React.ReactNode
	ref?: React.Ref<InstallButtonConnectedHandle>
}) {
	const {t} = useTranslation()
	const appInstall = useAppInstall(app.id)
	const isMember = trpcReact.user.get.useQuery().data?.role === 'member'
	const {apps, ambiguousAppIds} = useAllAvailableApps()
	const {userAppsKeyed, isLoading} = useApps()
	const openApp = useLaunchApp()
	const updateApp = useUpdateApp(app.id)
	const [showDepsDialog, setShowDepsDialog] = useState(false)
	const [showOSUpdateRequiredDialog, setShowOSUpdateRequiredDialog] = useState(false)
	const selections = useRef({} as Record<string, string>).current
	const [highlightDependency, setHighlightDependency] = useState<string | undefined>(undefined)

	const ready = !isLoading && Boolean(userAppsKeyed && apps && ambiguousAppIds)
	const isAppIdAmbiguous = Boolean(ambiguousAppIds?.has(app.id))
	const isInstalled = (appId: string) =>
		Boolean(userAppsKeyed && arrayIncludes(installedStates, userAppsKeyed[appId]?.state))
	const dependencies =
		ready && apps && userAppsKeyed && ambiguousAppIds
			? getDependencyAlternatives(app.dependencies, apps, userAppsKeyed, ambiguousAppIds)
			: []

	if (ready) {
		// Preserve an installed alternative across both action renderers.
		dependencies.forEach(({dependencyId, appIds}) => {
			appIds.forEach((appId) => {
				if (!selections[dependencyId] && isInstalled(appId)) selections[dependencyId] = appId
			})
		})
	}

	const areAllAlternativesSelectedAndInstalled = dependencies.every(({dependencyId, appIds}) =>
		appIds.some((appId) => selections[dependencyId] === appId && isInstalled(appId)),
	)

	const install = () => {
		if (!ready) return
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
			setShowDepsDialog(true)
			return
		}
		appInstall.install()
	}

	useImperativeHandle(ref, () => ({
		triggerInstall(dependencyId?: string) {
			setHighlightDependency(dependencyId)
			install()
		},
	}))

	const verifyInstall = (selectedDeps: Record<string, string>) => {
		if (isAppIdAmbiguous) return
		if (areAllAlternativesSelectedAndInstalled) appInstall.install(selectedDeps)
	}

	const userApp = userAppsKeyed?.[app.id]
	const updateAvailable = !isMember && !!userApp && isAppUpdateAvailable(userApp.version, app)
	const canOfferUpdate = ready && updateAvailable && canPresentUpdateAction(appInstall.state)
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

	const installSize = app.installSize ? prettyBytes(app.installSize) : undefined
	const controller: InstallController = ready
		? {
				status: 'ready',
				app,
				installSize,
				progress: appInstall.progress,
				installState: appInstall.state,
				install,
				open: () => openApp(app.id),
				update,
				updatePending: updateApp.isPending,
				canOfferUpdate,
				isAppIdAmbiguous,
			}
		: {status: 'loading', app, installSize, progress: appInstall.progress}

	return (
		<InstallButtonControllerContext value={controller}>
			{children}
			{ready && (
				<>
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
				</>
			)}
		</InstallButtonControllerContext>
	)
}

export function InstallButtonConnectedView() {
	const {t} = useTranslation()
	const controller = useContext(InstallButtonControllerContext)
	if (!controller) throw new Error('InstallButtonConnectedView must be used within InstallButtonConnectedController')

	if (controller.status === 'loading') {
		return (
			<InstallButton
				key={controller.app.id}
				installSize={controller.installSize}
				progress={controller.progress}
				state='loading'
			/>
		)
	}

	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex items-center gap-3 max-sm:flex-col max-sm:items-stretch md:gap-4'>
				<InstallButton
					key={controller.app.id}
					installSize={controller.installSize}
					progress={controller.progress}
					state={controller.installState}
					onInstallClick={controller.install}
					onOpenClick={controller.open}
					disabled={controller.isAppIdAmbiguous && controller.installState === 'not-installed'}
				/>
				{controller.canOfferUpdate && (
					<Button
						size='lg'
						onClick={controller.update}
						disabled={controller.isAppIdAmbiguous || controller.updatePending}
						className='max-sm:h-[30px] max-sm:w-full max-sm:text-13'
					>
						{t('app-updates.update')}
					</Button>
				)}
			</div>
			{controller.isAppIdAmbiguous && (
				<p className='max-w-64 text-right text-11 leading-tight text-amber-200/70 max-sm:text-center'>
					{t('app-store.app-id-conflict')}
				</p>
			)}
		</div>
	)
}

export function InstallButtonConnected({app, ref}: {app: RegistryApp; ref?: React.Ref<InstallButtonConnectedHandle>}) {
	return (
		<InstallButtonConnectedController app={app} ref={ref}>
			<InstallButtonConnectedView />
		</InstallButtonConnectedController>
	)
}
