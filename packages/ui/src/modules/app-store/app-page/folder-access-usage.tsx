import {ChevronDown} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {cn} from '@/lib/utils'
import {getAppStorageSourcePaths} from '@/modules/apps/app-storage'
import type {UserApp} from '@/trpc/trpc'

import {storagePathsOverlap} from './storage-paths'

export function getAppsUsingSourcePath(userApps: UserApp[], currentAppId: string, sourcePath: string) {
	return userApps.filter((userApp) => {
		if (userApp.id === currentAppId) return false
		return getAppStorageSourcePaths(userApp).some((appSourcePath) => storagePathsOverlap(appSourcePath, sourcePath))
	})
}

export function StorageSharedFolderHint({apps}: {apps: UserApp[]}) {
	const {t, i18n} = useTranslation()
	const [open, setOpen] = useState(false)

	if (apps.length === 0) return null

	const listFormat = new Intl.ListFormat(i18n.language, {style: 'long', type: 'conjunction'})
	const appNames = apps.map((app) => app.name || app.id)
	// Name every app up to three; beyond that, name two and fold the rest into
	// a count ("Also shared with A, B and 2 others"). Icons mirror the named
	// apps so the numbers in view never disagree.
	const namedAppNames = apps.length > 3 ? appNames.slice(0, 2) : appNames
	const hiddenAppCount = apps.length - namedAppNames.length
	const canExpand = apps.length > 3
	const text = t('app-settings.storage.also-shared-with', {
		apps: listFormat.format(
			hiddenAppCount > 0
				? [...namedAppNames, t('app-settings.storage.other-app-count', {count: hiddenAppCount})]
				: namedAppNames,
		),
	})
	const title = t('app-settings.storage.also-shared-with', {apps: listFormat.format(appNames)})
	const hintContent = (
		<>
			<div className='flex shrink-0 -space-x-1'>
				{apps.slice(0, namedAppNames.length).map((app) => (
					<AppIcon key={app.id} src={app.icon} size={16} className='rounded-4 ring-1 ring-[#1f1f1f]' />
				))}
			</div>
			<span className='min-w-0 truncate'>{text}</span>
			{canExpand ? <ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} /> : null}
		</>
	)

	return (
		<div className='space-y-1 px-0.5'>
			{canExpand ? (
				<button
					type='button'
					onClick={() => setOpen((currentOpen) => !currentOpen)}
					className='flex min-w-0 items-center gap-1.5 text-11 text-white/35 transition-colors hover:text-white/55'
					title={title}
				>
					{hintContent}
				</button>
			) : (
				<div className='flex min-w-0 items-center gap-1.5 text-11 text-white/35' title={title}>
					{hintContent}
				</div>
			)}

			{canExpand && open ? (
				<div className='flex flex-wrap gap-1 rounded-8 bg-white/4 px-2 py-2'>
					{apps.map((app) => (
						<div
							key={app.id}
							className='flex max-w-full min-w-0 items-center gap-1 rounded-full bg-white/5 py-1 pr-2 pl-1'
						>
							<AppIcon src={app.icon} size={16} className='rounded-4' />
							<span className='truncate text-11 text-white/55'>{app.name || app.id}</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	)
}
