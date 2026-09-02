import {TFunction} from 'i18next'
import {useTranslation} from 'react-i18next'
import {PiAppWindowFill} from 'react-icons/pi'
import {TbChevronRight} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Loading} from '@/components/ui/loading'
import {cn} from '@/lib/utils'
import {getAppWarning} from '@/modules/apps/app-warnings'
import {useWallpaper} from '@/providers/wallpaper'
import {trpcReact, UserApp} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

import {SettingsViewHeader} from './shared'

function getAppStatus(app: UserApp, t: TFunction): {label: string; tone: 'muted' | 'warning'} | null {
	const warning = getAppWarning(app)
	if (warning === 'app-storage') return {label: t('app-settings.storage.app-storage-unavailable'), tone: 'warning'}
	if (warning === 'app-data-missing') return {label: t('app-settings.storage.app-data-missing-short'), tone: 'warning'}
	if (warning === 'folder-access') return {label: t('app-settings.warning.folder-access'), tone: 'warning'}

	switch (app.state) {
		case 'unknown':
		case 'stopped':
			return {label: t('app.offline'), tone: 'muted'}
		case 'installing':
			return {label: t('app.installing'), tone: 'muted'}
		case 'starting':
			return {label: t('app.starting'), tone: 'muted'}
		case 'restarting':
			return {label: t('app.restarting'), tone: 'muted'}
		case 'stopping':
			return {label: t('app.stopping'), tone: 'muted'}
		case 'updating':
			return {label: t('app.updating'), tone: 'muted'}
		case 'uninstalling':
			return {label: t('app.uninstalling'), tone: 'muted'}
		case 'ready':
		case 'running':
			return null
	}
}

/**
 * The app-list step of the app settings dialog: choose which installed app to
 * manage. Rows link to the same dialog with the app selected, so picking an
 * app slides this view over to that app's settings.
 */
export function AppSettingsListContent() {
	const {t} = useTranslation()
	const linkToDialog = useLinkToDialog()

	const {data: apps, isLoading} = trpcReact.apps.list.useQuery()
	const installedApps = (apps ?? []).filter((app): app is UserApp => !('error' in app))

	const list = isLoading ? (
		<div className='flex justify-center py-10'>
			<Loading />
		</div>
	) : installedApps.length === 0 ? (
		<div className='py-10 text-center text-14 text-white/40'>{t('app-settings-list.no-apps')}</div>
	) : (
		<div className='divide-y divide-white/6 overflow-hidden rounded-12'>
			{installedApps.map((app) => {
				const status = getAppStatus(app, t)

				return (
					<Link
						key={app.id}
						to={linkToDialog('app-settings', {for: app.id})}
						className='flex items-center gap-3 bg-white/6 p-3 transition-colors hover:bg-white/8'
					>
						<AppIcon src={app.icon} size={36} className='rounded-8' />
						<div className='flex min-w-0 flex-1 flex-col gap-1'>
							<div className='truncate text-14 font-medium -tracking-2'>{app.name}</div>
							{status ? (
								<div
									className={cn(
										'truncate text-12 -tracking-2',
										status.tone === 'warning' ? 'text-yellow-200/70' : 'text-white/40',
									)}
								>
									{status.label}
								</div>
							) : null}
						</div>
						<TbChevronRight className='size-4 shrink-0 text-white/30' />
					</Link>
				)
			})}
		</div>
	)

	return (
		<div className='flex flex-col gap-y-5'>
			<SettingsViewHeader title={t('app-settings-list.title')} description={t('app-settings-list.description')} />
			{list}
		</div>
	)
}

export function AppSettingsListSidebar() {
	const {t} = useTranslation()
	const {wallpaper} = useWallpaper()
	const [hue, saturation] = wallpaper.brandColorHsl.split(' ')

	return (
		<div className='flex w-full flex-col items-center px-4 text-center'>
			{/* The Settings page's App settings row tile (see SettingsRowIcon in
			    ./shared.tsx), scaled up to the sidebar identity size */}
			<div
				aria-hidden='true'
				className='grid size-16 place-items-center rounded-15'
				style={{
					boxShadow:
						'inset 0 1px 0 rgb(255 255 255 / 0.28), inset 0 0 0 1px rgb(255 255 255 / 0.08), 0 1px 2px rgb(0 0 0 / 0.25)',
					background: `linear-gradient(to bottom, rgb(255 255 255 / 0.18), rgb(0 0 0 / 0.28)), hsl(${hue} ${saturation} 54%)`,
				}}
			>
				<PiAppWindowFill className='size-8 text-white' />
			</div>
			<div className='mt-2.5 w-full truncate text-15 font-medium'>{t('app-settings-list.title')}</div>
		</div>
	)
}
