import {createContext, useContext, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {registryAppPath} from '@/constants/app-store'
import {beginAppAction, finishAppAction} from '@/hooks/app-action-guard'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useUpdateAppMutation} from '@/hooks/use-update-app'
import {getDependencyAlternatives} from '@/modules/app-store/dependency-alternatives'
import {OSUpdateRequiredDialog} from '@/modules/app-store/os-update-required'
import {SelectDependenciesDialog} from '@/modules/app-store/select-dependencies-dialog'
import {canPresentUpdateAction} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {AppState, RegistryApp, trpcReact} from '@/trpc/trpc'

type StoreActionsContextT = {
	installApp: (app: RegistryApp) => void
	updateApp: (app: RegistryApp) => void
	openApp: (appId: string) => void
	isAppIdAmbiguous: (appId: string) => boolean
	pendingStates: ReadonlyMap<string, AppState>
}

const StoreActionsContext = createContext<StoreActionsContextT | null>(null)

/** Null when no provider is mounted — callers fall back to passive labels */
export function useStoreActions() {
	return useContext(StoreActionsContext)
}

/**
 * One shared install/update/open flow for every app card in the subtree, so
 * hundreds of cards can offer working actions without each mounting its own
 * dialogs. Runs the same gates as the app page's install button: members are
 * pointed to the owner, incompatible apps explain the required OS update, and
 * dependencies are chosen before installing.
 */
export function StoreActionsProvider({children}: {children: React.ReactNode}) {
	const {t} = useTranslation()
	const isMember = trpcReact.user.get.useQuery().data?.role === 'member'
	const {apps, ambiguousAppIds} = useAllAvailableApps()
	const {userAppsKeyed} = useApps()
	const launchApp = useLaunchApp()
	const utils = trpcReact.useUtils()

	const [dialog, setDialog] = useState<{kind: 'os-update' | 'dependencies'; app: RegistryApp} | null>(null)
	const [pendingStates, setPendingStates] = useState<ReadonlyMap<string, AppState>>(new Map())
	const setPendingState = (appId: string, state?: AppState) => {
		setPendingStates((current) => {
			const next = new Map(current)
			if (state) next.set(appId, state)
			else next.delete(appId)
			return next
		})
	}

	const installMut = trpcReact.apps.install.useMutation({
		// Optimistic seeding: the mutation doesn't return until the install
		// completes, so make the transition visible immediately
		onMutate: ({appId}) => {
			setPendingState(appId, 'installing')
			utils.apps.state.cancel()
			utils.apps.state.setData({appId}, {state: 'installing', progress: 0})
			setTimeout(() => utils.apps.list.invalidate(), 2000)
		},
		onSettled: (_data, _error, {appId}) => {
			finishAppAction(appId)
			setPendingState(appId)
			utils.apps.state.invalidate({appId})
			utils.apps.list.invalidate()
			utils.user.get.invalidate()
		},
	})

	// The same optimistic seeding and refresh as every other update surface
	const updateMut = useUpdateAppMutation()

	const installApp = (app: RegistryApp) => {
		if (isMember) return void toast(t('app-store.ask-owner-to-install'), {area: 'app-store'})
		if (ambiguousAppIds?.has(app.id)) return void toast(t('app-store.app-id-conflict'), {area: 'app-store'})
		if (!app.compatible) return setDialog({kind: 'os-update', app})
		if (app.dependencies && app.dependencies.length > 0) return setDialog({kind: 'dependencies', app})
		if (beginAppAction(app.id)) installMut.mutate({appId: app.id})
	}

	const updateApp = (app: RegistryApp) => {
		if (isMember) return void toast(t('app-store.ask-owner-to-update'), {area: 'app-store'})
		if (ambiguousAppIds?.has(app.id)) return void toast(t('app-store.app-id-conflict'), {area: 'app-store'})
		const state = userAppsKeyed?.[app.id]?.state ?? 'not-installed'
		if (!canPresentUpdateAction(state)) return
		if (!app.compatible) return setDialog({kind: 'os-update', app})
		updateMut.mutate({appId: app.id})
	}

	const closeDialog = (open: boolean) => {
		if (!open) setDialog(null)
	}
	const installWithDependencies = (appId: string, alternatives: Record<string, string>) => {
		if (ambiguousAppIds?.has(appId)) return void toast(t('app-store.app-id-conflict'), {area: 'app-store'})
		if (beginAppAction(appId)) installMut.mutate({appId, alternatives})
	}

	return (
		<StoreActionsContext
			value={{
				installApp,
				updateApp,
				openApp: launchApp,
				isAppIdAmbiguous: (appId) => ambiguousAppIds?.has(appId) ?? false,
				pendingStates,
			}}
		>
			{children}
			{dialog?.kind === 'os-update' && <OSUpdateRequiredDialog app={dialog.app} open onOpenChange={closeDialog} />}
			{dialog?.kind === 'dependencies' && (
				<SelectDependenciesDialog
					appId={dialog.app.id}
					dependencies={getDependencyAlternatives(dialog.app.dependencies, apps ?? [], userAppsKeyed, ambiguousAppIds)}
					open
					onOpenChange={closeDialog}
					onNext={(selectedDeps) => installWithDependencies(dialog.app.id, selectedDeps)}
					onInstallDependency={installApp}
					makeDependencyPath={registryAppPath}
				/>
			)}
		</StoreActionsContext>
	)
}
