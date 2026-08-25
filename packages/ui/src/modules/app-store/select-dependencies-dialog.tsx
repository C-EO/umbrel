import {SetStateAction, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {ChevronDown} from '@/components/chevron-down'
import {ProgressButton} from '@/components/progress-button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {ScrollArea} from '@/components/ui/scroll-area'
import {registryAppPath} from '@/constants/app-store'
import {pollStates, useAppInstall} from '@/hooks/use-app-install'
import {cn} from '@/lib/utils'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import type {DependencyAlternatives} from '@/modules/app-store/dependency-alternatives'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {installedStates, RegistryApp, UserApp} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

type DependencyApp = RegistryApp | UserApp

export function SelectDependenciesDialog({
	open,
	onOpenChange,
	appId,
	dependencies,
	onNext,
	highlightDependency,
	onInstallDependency,
	makeDependencyPath = registryAppPath,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	appId: string
	dependencies: DependencyAlternatives[]
	onNext: (selectedDeps: Record<string, string>) => void
	highlightDependency?: string
	onInstallDependency?: (app: RegistryApp) => void
	makeDependencyPath?: (app: RegistryApp) => string
}) {
	const {t} = useTranslation()
	const availableApps = useAllAvailableApps()
	const {isLoading, userApps, userAppsKeyed} = useApps()
	const [selectedDependencies, setSelectedDependencies] = useState<Record<string, string>>({})

	// Try user app first in case the app was installed at some point but is not
	// present in an app store anymore, for example because a community app store
	// has been removed. UserApp and RegistryApp share the necessary properties.
	const registryApp = availableApps.appsKeyed?.[appId]
	const userApp = userAppsKeyed?.[appId]
	const app = userApp ?? registryApp
	if (!app) throw new Error('App not found')

	if (isLoading || !userApps || !userAppsKeyed || availableApps.isLoading) return null

	const appName = app?.name

	// A dependency counts as installed once its selected alternative is installed.
	const installedCount = dependencies.filter(({dependencyId, appIds}) => {
		const selectedApp = userAppsKeyed[selectedDependencies[dependencyId]]
		return !!selectedApp && appIds.includes(selectedApp.id) && arrayIncludes(installedStates, selectedApp.state)
	}).length
	const areAllDependenciesInstalled = installedCount === dependencies.length

	return (
		// The store's alert-dialog treatment (icon, centered copy, centered
		// actions), with the dependency list between the copy and the actions
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent
				className='umbrel-app-store-modal'
				onOpenAutoFocus={(e) => {
					// `preventDefault` to prevent focus on first input
					e.preventDefault()
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('install-first.title', {app: appName, count: dependencies.length})}</AlertDialogTitle>
				</AlertDialogHeader>
				<SelectDependencies
					dependencies={dependencies}
					selectedDependencies={selectedDependencies}
					setSelectedDependencies={setSelectedDependencies}
					onLeave={() => onOpenChange(false)}
					highlightDependency={highlightDependency}
					onInstallDependency={onInstallDependency}
					makeDependencyPath={makeDependencyPath}
				/>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='primary'
						className='px-6'
						disabled={!areAllDependenciesInstalled}
						onClick={() => {
							onOpenChange(false)
							onNext(selectedDependencies)
						}}
					>
						{t('install-first.install-app', {app: appName})}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

// Reusable dependencies selection
export function SelectDependencies({
	dependencies,
	selectedDependencies,
	setSelectedDependencies,
	onLeave,
	highlightDependency,
	onInstallDependency,
	makeDependencyPath = registryAppPath,
}: {
	dependencies: DependencyAlternatives[]
	selectedDependencies: Record<string, string>
	setSelectedDependencies: (selectedDependencies: Record<string, string>) => void
	/** The user is leaving for a dependency's own page or install flow — close the surrounding dialog */
	onLeave: () => void
	highlightDependency?: string
	onInstallDependency?: (app: RegistryApp) => void
	makeDependencyPath?: (app: RegistryApp) => string
}) {
	const {t} = useTranslation()
	const {apps, appsKeyed} = useAllAvailableApps()
	const {isLoading, userApps, userAppsKeyed} = useApps()
	const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({})

	// Reify dependency data once we have the list of available apps
	const reifiedDependencies = useMemo(() => {
		if (!appsKeyed || !userAppsKeyed) return []
		return dependencies.map(({dependencyId, appIds}) => ({
			dependencyId,
			apps: appIds.flatMap((appId) => {
				const app: DependencyApp | undefined = userAppsKeyed[appId] ?? appsKeyed[appId]
				return app ? [app] : []
			}),
		}))
	}, [appsKeyed, dependencies, userAppsKeyed])

	// Pre-select installed apps or main alternatives when dependencies change or
	// when the list of user/available apps becomes available
	useEffect(() => {
		if (!userAppsKeyed || reifiedDependencies.length === 0) return
		const newSelectedDependencies: Record<string, string> = {
			...selectedDependencies,
		}

		reifiedDependencies.forEach(({dependencyId, apps}) => {
			if (apps.some((app) => app.id === newSelectedDependencies[dependencyId])) return

			const installedOrInstallingApp = apps.find((app) => {
				const userApp = userAppsKeyed?.[app.id]
				return userApp && (arrayIncludes(installedStates, userApp.state) || userApp.state === 'installing')
			})

			const nextApp = installedOrInstallingApp ?? apps[0]
			if (nextApp) newSelectedDependencies[dependencyId] = nextApp.id
			else delete newSelectedDependencies[dependencyId]
		})

		setSelectedDependencies(newSelectedDependencies)
	}, [dependencies, userAppsKeyed, reifiedDependencies])

	if (isLoading || !userApps || !userAppsKeyed || !apps || !appsKeyed) return null

	const selectDependency = (dependencyId: string, appId: string) => {
		const newSelectedDependencies = {
			...selectedDependencies,
			[dependencyId]: appId,
		}
		setSelectedDependencies(newSelectedDependencies)
	}

	return (
		<div className={listClass}>
			{reifiedDependencies.map(({dependencyId, apps: alternatives}) => {
				const app = alternatives[0]
				if (!app) {
					return (
						<div key={dependencyId} className={listItemClass}>
							<span className='truncate pl-1 text-white/50'>{dependencyId}</span>
							<span className='text-12 text-white/40'>{t('app-store.dependency-metadata-unavailable')}</span>
						</div>
					)
				}
				const hasAlternatives = alternatives.length > 1

				if (!hasAlternatives) {
					// If no alternatives, just show the app name and state
					return (
						<div key={dependencyId} className={listItemClass}>
							<span className='flex flex-1 flex-row items-center gap-2 pl-1'>
								{app.icon && <AppIcon size={26} src={app.icon} className='rounded-6' />}
								{app.name}
							</span>
							<DependencyAction
								app={app}
								availableApp={appsKeyed[app.id]}
								onLeave={onLeave}
								onInstallDependency={onInstallDependency}
								makeDependencyPath={makeDependencyPath}
							/>
						</div>
					)
				}

				// If has alternatives, show dropdown
				return (
					<div key={dependencyId} className={listItemClassWithDropdown}>
						<DependencyDropdown
							dependencyId={dependencyId}
							selectedApp={alternatives.find((app) => app.id === selectedDependencies[dependencyId])}
							alternatives={alternatives.map((app) => ({dependencyId, app}))}
							openDropdowns={openDropdowns}
							setOpenDropdowns={setOpenDropdowns}
							onSelectDependency={selectDependency}
							highlightDependency={highlightDependency}
						/>
						<DependencyAction
							app={alternatives.find((app) => app.id === selectedDependencies[dependencyId])}
							availableApp={appsKeyed[selectedDependencies[dependencyId]]}
							onLeave={onLeave}
							onInstallDependency={onInstallDependency}
							makeDependencyPath={makeDependencyPath}
						/>
					</div>
				)
			})}
		</div>
	)
}

const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const listItemClass = tw`flex items-center pl-3 pr-4 h-[50px] text-[14px] font-medium -tracking-3 justify-between`
const listItemClassWithDropdown = tw`flex items-center pl-3 pr-4 h-[60px] text-[14px] font-medium -tracking-3 justify-between`

/**
 * The selected dependency's status and actions: installed, or two buttons —
 * View (its page) and the primary Install, which fills with live progress
 * like every other install button. Install happens right here when the
 * dependency is ready to install; a dependency that itself needs an OS
 * update or other apps first is handed to the full flow (the store's shared
 * actions, or its own page when no provider is mounted), since the backend
 * doesn't check a dependency's own dependencies.
 */
function DependencyAction({
	app,
	availableApp,
	onLeave,
	onInstallDependency,
	makeDependencyPath,
}: {
	app?: DependencyApp
	availableApp?: RegistryApp
	onLeave: () => void
	onInstallDependency?: (app: RegistryApp) => void
	makeDependencyPath: (app: RegistryApp) => string
}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	// Per-app state (optimistic seeds included), so the row flips to
	// "Installing…" the moment the button is pressed
	const appInstall = useAppInstall(app?.id ?? '')

	if (!app) return null

	const state = appInstall.state
	if (state === 'loading') return null
	const transitioning = arrayIncludes(pollStates, state)

	if (arrayIncludes(installedStates, state)) {
		return (
			<Button disabled variant='default' size='sm' className='opacity-50'>
				{t('app.installed')}
			</Button>
		)
	}
	if (!availableApp) {
		return (
			<Button disabled variant='default' size='sm' className='opacity-50'>
				{t('app-store.dependency-metadata-unavailable')}
			</Button>
		)
	}

	const showProgress = state === 'installing' && appInstall.progress !== undefined

	const needsFullFlow = !availableApp.compatible || (availableApp.dependencies?.length ?? 0) > 0

	const pagePath = makeDependencyPath(availableApp)

	const install = () => {
		if (!needsFullFlow) {
			if (onInstallDependency) onInstallDependency(availableApp)
			else appInstall.install()
			return
		}
		onLeave()
		if (onInstallDependency) onInstallDependency(availableApp)
		else navigate(pagePath, {state: {fromAppStore: true}})
	}

	return (
		<span className='flex items-center gap-2'>
			{/* Once the install is running the progress button is the whole story */}
			{!transitioning && (
				<ButtonLink to={pagePath} state={{fromAppStore: true}} onClick={onLeave} size='sm'>
					{t('app.view')}
				</ButtonLink>
			)}
			{/* Disables itself while the app transitions (see ProgressButton) */}
			<ProgressButton
				variant='primary'
				size='sm'
				state={state}
				progress={appInstall.progress}
				onClick={install}
				disabled={state !== 'not-installed'}
				style={{['--progress-button-bg' as string]: 'hsl(var(--color-brand))'}}
			>
				{transitioning ? appStateToString(state, t) + '...' : t('app.install')}
				{showProgress && (
					<span className='ml-1 inline-block w-[4ch] text-right opacity-60'>{Math.round(appInstall.progress!)}%</span>
				)}
			</ProgressButton>
		</span>
	)
}

function DependencyDropdown({
	dependencyId,
	selectedApp,
	alternatives,
	openDropdowns,
	setOpenDropdowns,
	onSelectDependency,
	highlightDependency,
}: {
	dependencyId: string
	selectedApp?: DependencyApp
	alternatives: {dependencyId: string; app: DependencyApp}[]
	openDropdowns: Record<string, boolean>
	setOpenDropdowns: (value: SetStateAction<Record<string, boolean>>) => void
	onSelectDependency: (dependencyId: string, appId: string) => void
	highlightDependency?: string
}) {
	const {t} = useTranslation()
	const onOpenChange = (open: boolean) => setOpenDropdowns((prev) => ({...prev, [dependencyId]: open}))
	return (
		<DropdownMenu open={openDropdowns[dependencyId] ?? false} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild className={cn(highlightDependency === dependencyId && 'umbrel-pulse-a-few-times')}>
				{/* Leaves room for the row's View + Install pair */}
				<Button className='h-[40px] w-[256px] max-w-[calc(100%-150px)] px-4'>
					<div className='flex min-w-0 flex-1 items-center gap-2 text-left'>
						{selectedApp ? (
							<>
								{selectedApp.icon && <AppIcon size={26} src={selectedApp.icon} className='shrink-0 rounded-6' />}
								<div className='min-w-0 flex-1'>
									<span className='block truncate text-[14px]'>{selectedApp.name}</span>
								</div>
							</>
						) : (
							<div className='min-w-0 flex-1'>
								<span className='block truncate text-[14px]'>{t('app-picker.select-app')}</span>
							</div>
						)}
					</div>
					<ChevronDown />
				</Button>
			</DropdownMenuTrigger>
			{/* p-1 overrides the default dropdown padding to match the desktop context menu */}
			<DropdownMenuContent className='flex max-h-72 w-[256px] flex-col p-1' align='start'>
				<ScrollArea className='relative flex h-full flex-col'>
					{alternatives.map(({app}) => (
						<DropdownMenuCheckboxItem
							key={app.id}
							checked={app.id === selectedApp?.id}
							onSelect={() => {
								onSelectDependency(dependencyId, app.id)
								onOpenChange(false)
							}}
							className='flex gap-2'
						>
							<AppIcon size={20} src={app.icon} className='rounded-4' />
							{app.name}
						</DropdownMenuCheckboxItem>
					))}
				</ScrollArea>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
