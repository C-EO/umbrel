import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCpu} from 'react-icons/tb'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {AnimatedHeight} from '@/components/ui/animated-height'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {Switch} from '@/components/ui/switch'
import {registryAppPath} from '@/constants/app-store'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {FolderPickerRow} from '@/features/files/components/shared/path-breadcrumbs'
import {EXTERNAL_STORAGE_PATH, HOME_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {cn} from '@/lib/utils'
import {useApps} from '@/providers/apps'
import {installedStates, type RegistryApp, type RouterOutput} from '@/trpc/trpc'

import {getAppsUsingSourcePath, StorageSharedFolderHint} from './app-page/folder-access-usage'
import {FolderAccessPill, SettingsControlRow, SettingsViewTransition} from './app-page/shared'
import {
	getManagedDataRootPath,
	getStorageBrowserOpenPath,
	isFolderAccessSourceSelectable,
	isStorageBrowserPath,
	storagePathsOverlap,
} from './app-page/storage-paths'
import type {DependencyAlternatives} from './dependency-alternatives'
import {SelectDependencies, type InstallDependency} from './select-dependencies-dialog'

type InstallReview = RouterOutput['apps']['installReview']
type FolderSelection = {id: string; sourcePath: string}
type InstallReviewStep = 'apps' | 'folders' | 'gpu'

/**
 * Pre-install review as a compact stepped dialog: one concern per step
 * (required apps, then folder access, then GPU), each a single sentence plus
 * its control. Steps that don't apply don't exist, so a single concern reads
 * as a plain one-shot dialog with no stepping at all. The final step's
 * primary action becomes the install button.
 */
export function InstallReviewDialog({
	app,
	review,
	dependencies,
	open,
	onOpenChange,
	onInstall,
	highlightDependency,
	onInstallDependency,
	makeDependencyPath = registryAppPath,
}: {
	app: RegistryApp
	review: InstallReview
	dependencies: DependencyAlternatives[]
	open: boolean
	onOpenChange: (open: boolean) => void
	onInstall: (options: {alternatives: Record<string, string>; folderAccess: FolderSelection[]}) => void
	highlightDependency?: string
	onInstallDependency?: InstallDependency
	makeDependencyPath?: (app: RegistryApp) => string
}) {
	const {t} = useTranslation()
	const {userApps, userAppsKeyed} = useApps()
	const [selectedDependencies, setSelectedDependencies] = useState<Record<string, string>>({})
	const [selectedFolders, setSelectedFolders] = useState<Record<string, string>>({})
	const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
	const [stepIndex, setStepIndex] = useState(0)

	useEffect(() => {
		if (!open) return
		setSelectedFolders(
			Object.fromEntries(review.requiredFolders.map((folder) => [folder.id, folder.defaultSourcePath])),
		)
		setActiveFolderId(null)
		setStepIndex(0)
	}, [open, review.requiredFolders])

	if (!userApps || !userAppsKeyed) return null

	const steps: InstallReviewStep[] = [
		...(dependencies.length > 0 ? (['apps'] as const) : []),
		...(review.requiredFolders.length > 0 ? (['folders'] as const) : []),
		...(review.gpuAccess ? (['gpu'] as const) : []),
	]
	// Parents only open this dialog when at least one concern exists, but the
	// clamp keeps a shrinking step list from stranding the index out of range
	const currentStep = Math.min(stepIndex, Math.max(steps.length - 1, 0))
	const step = steps[currentStep] ?? 'apps'
	const isLastStep = currentStep >= steps.length - 1

	const dependenciesReady = dependencies.every(({dependencyId, appIds}) =>
		appIds.some(
			(appId) =>
				selectedDependencies[dependencyId] === appId && arrayIncludes(installedStates, userAppsKeyed[appId]?.state),
		),
	)
	const foldersReady = review.requiredFolders.every((folder) => Boolean(selectedFolders[folder.id]))
	const activeFolder = review.requiredFolders.find((folder) => folder.id === activeFolderId)
	const managedDataRoots = userApps.flatMap((userApp) => getManagedDataRootPath(userApp) ?? [])
	const activeFolderPath = activeFolder ? selectedFolders[activeFolder.id] : undefined
	const activeFolderPathIsSelectable = Boolean(
		activeFolderPath &&
		isStorageBrowserPath(activeFolderPath) &&
		isFolderAccessSourceSelectable({path: activeFolderPath}) &&
		!managedDataRoots.some((dataRoot) => storagePathsOverlap(activeFolderPath, dataRoot)),
	)

	const install = () => {
		const folderAccess = review.requiredFolders.flatMap((folder) => {
			const sourcePath = selectedFolders[folder.id]
			return sourcePath && sourcePath !== folder.defaultSourcePath ? [{id: folder.id, sourcePath}] : []
		})
		onInstall({alternatives: selectedDependencies, folderAccess})
		onOpenChange(false)
	}

	// Continue gates only on the step in front of the user; the final install
	// re-checks everything in case an earlier step's state changed underneath
	const stepReady = step === 'apps' ? dependenciesReady : step === 'folders' ? foldersReady : true
	const continueDisabled = isLastStep ? !(dependenciesReady && foldersReady) : !stepReady
	const next = () => {
		if (isLastStep) install()
		else setStepIndex(currentStep + 1)
	}

	const stepDescription =
		step === 'apps' ? (
			t('install-review.dependencies-description', {app: app.name, count: dependencies.length})
		) : step === 'folders' ? (
			<>
				<span className='mb-2 block'>
					{t('install-review.folder-access-description', {app: app.name, count: review.requiredFolders.length})}
				</span>
				<span className='block'>
					{t('install-review.folder-access-hint', {count: review.requiredFolders.length, app: app.name})}
				</span>
			</>
		) : (
			t('install-review.gpu-description', {app: app.name})
		)

	const stepContent =
		step === 'apps' ? (
			<SelectDependencies
				dependencies={dependencies}
				selectedDependencies={selectedDependencies}
				setSelectedDependencies={setSelectedDependencies}
				onLeave={(afterLeave) => {
					onOpenChange(false)
					afterLeave?.()
				}}
				highlightDependency={highlightDependency}
				onInstallDependency={onInstallDependency}
				makeDependencyPath={makeDependencyPath}
			/>
		) : step === 'folders' ? (
			<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/5'>
				{review.requiredFolders.map((folder) => {
					const sourcePath = selectedFolders[folder.id]
					const appsUsingFolder = sourcePath ? getAppsUsingSourcePath(userApps, app.id, sourcePath) : []

					return (
						<div key={folder.id} className='space-y-3 p-4'>
							<div className='min-w-0 space-y-1'>
								<div className='flex min-w-0 items-center justify-between gap-2'>
									<span className='min-w-0 truncate text-14 font-medium text-white/90'>{folder.name}</span>
									<FolderAccessPill appName={app.name} readOnly={folder.readOnly} />
								</div>
								<p className='text-12 leading-tight text-white/40'>
									{folder.note ?? t('app-settings.storage.inferred-folder-note', {app: app.name})}
								</p>
							</div>
							<FolderPickerRow
								path={sourcePath}
								actionLabel={t('change')}
								onAction={() => setActiveFolderId(folder.id)}
							/>
							{sourcePath ? <StorageSharedFolderHint apps={appsUsingFolder} /> : null}
						</div>
					)
				})}
			</div>
		) : (
			<SettingsControlRow
				title={t('install-review.gpu-access')}
				description={t('install-review.gpu-required', {app: app.name})}
				icon={TbCpu}
				control={<Switch checked disabled />}
			/>
		)

	return (
		<>
			<Dialog open={open && !activeFolder} onOpenChange={onOpenChange}>
				<DialogContent className='gap-0 p-0' onOpenAutoFocus={(event) => event.preventDefault()}>
					<div className='flex items-center gap-3 px-5 pt-5 md:px-8 md:pt-8'>
						<AppIcon src={app.icon} size={40} className='rounded-10' />
						<DialogTitle className='min-w-0 flex-1 truncate'>{t('install-review.title', {app: app.name})}</DialogTitle>
					</div>

					<div className='min-h-0 overflow-y-auto overscroll-contain px-5 py-4 md:px-8 md:py-5'>
						<AnimatedHeight>
							<SettingsViewTransition viewKey={step} depth={currentStep}>
								<div className='space-y-3'>
									<DialogDescription className='space-y-1'>{stepDescription}</DialogDescription>
									{stepContent}
								</div>
							</SettingsViewTransition>
						</AnimatedHeight>
					</div>

					<div className='flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pb-5 md:px-8 md:pb-8'>
						{steps.length > 1 && <StepDots current={currentStep} total={steps.length} />}
						<div className='ml-auto flex gap-2'>
							{currentStep === 0 ? (
								<Button size='dialog' className='w-auto' onClick={() => onOpenChange(false)}>
									{t('cancel')}
								</Button>
							) : (
								<Button size='dialog' className='w-auto' onClick={() => setStepIndex(currentStep - 1)}>
									{t('back')}
								</Button>
							)}
							<Button variant='primary' size='dialog' className='w-auto' disabled={continueDisabled} onClick={next}>
								{isLastStep ? t('install-review.install-now', {app: app.name}) : t('continue')}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			<MiniBrowser
				open={open && Boolean(activeFolder)}
				onOpenChange={(pickerOpen) => {
					if (!pickerOpen) setActiveFolderId(null)
				}}
				rootPath={HOME_PATH}
				rootPaths={[HOME_PATH, EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH]}
				onOpenPath={getStorageBrowserOpenPath(activeFolderPath)}
				preselectOnOpen={activeFolderPathIsSelectable}
				title={t('install-review.choose-folder', {folder: activeFolder?.name ?? ''})}
				selectionMode='folders'
				selectableFilter={(entry) =>
					isFolderAccessSourceSelectable(entry) &&
					!managedDataRoots.some((dataRoot) => storagePathsOverlap(entry.path, dataRoot))
				}
				allowNewFolderCreation
				selectButtonLabel={t('app-settings.storage.use-folder')}
				onSelect={(sourcePath) => {
					if (activeFolder) {
						setSelectedFolders((folders) => ({...folders, [activeFolder.id]: sourcePath}))
					}
					setActiveFolderId(null)
				}}
			/>
		</>
	)
}

function StepDots({current, total}: {current: number; total: number}) {
	const {t} = useTranslation()
	return (
		<div className='flex items-center gap-1.5'>
			<span className='sr-only'>{t('install-review.step-count', {current: current + 1, total})}</span>
			{Array.from({length: total}, (_, index) => (
				<span
					key={index}
					aria-hidden='true'
					className={cn(
						'h-1.5 rounded-full transition-all duration-300',
						index === current ? 'w-4 bg-white/80' : 'w-1.5 bg-white/20',
					)}
				/>
			))}
		</div>
	)
}
