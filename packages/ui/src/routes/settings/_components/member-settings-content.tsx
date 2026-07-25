import {useTranslation} from 'react-i18next'
import {RiComputerLine, RiKeyLine, RiLogoutCircleRLine, RiPulseLine, RiUserLine} from 'react-icons/ri'
import {useNavigate, useParams} from 'react-router-dom'

import {Card} from '@/components/ui/card'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {Switch} from '@/components/ui/switch'
import {useCpuTemperature} from '@/hooks/use-cpu-temperature'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {firstNameFromFullName} from '@/utils/misc'

import {CpuCardContent} from './cpu-card-content'
import {CpuTemperatureCardContent} from './cpu-temperature-card-content'
import {ListRow} from './list-row'
import {MemoryCardContent} from './memory-card-content'
import {SettingsSummary} from './settings-summary'
import {StorageCardContent} from './storage-card-content'
import {WallpaperPicker} from './wallpaper-picker'

// Member accounts can't manage the device, so they get a settings pane scoped
// to their own account (name, password, wallpaper, 2FA and logout) plus the
// read-only device summary and usual live usage stats. In the usage breakdowns
// the server folds apps that aren't shared with them into a single 'Other' entry.
export function MemberSettingsContent() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const userQ = trpcReact.user.get.useQuery()
	const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery()
	const cpuTemp = useCpuTemperature()

	const {settingsDialog} = useParams<{settingsDialog: 'wallpaper'}>()

	return (
		<div className='grid w-full animate-in gap-x-[30px] gap-y-[20px] fade-in lg:grid-cols-[280px_auto]'>
			<div className='flex flex-col gap-3'>
				<Card>
					<StorageCardContent />
				</Card>
				<Card>
					<MemoryCardContent />
				</Card>
				<Card>
					<CpuCardContent />
				</Card>
				<Card>
					<CpuTemperatureCardContent warning={cpuTemp.warning} temperatureInCelcius={cpuTemp.temperature} />
				</Card>
				<div className='mx-auto'>
					<IconButtonLink icon={RiPulseLine} to={linkToDialog('live-usage')}>
						{t('open-live-usage')}
					</IconButtonLink>
				</div>
			</div>
			<div className='flex flex-col gap-3'>
				<Card className='flex flex-wrap items-center justify-between gap-5'>
					<div>
						<h2 className='text-24 leading-none font-bold -tracking-4'>
							{userQ.data?.name && `${firstNameFromFullName(userQ.data.name)}’s`}{' '}
							<span className='opacity-40'>{t('umbrel')}</span>
						</h2>
						<div className='pt-5' />
						<SettingsSummary />
					</div>
					<IconButtonLink to={linkToDialog('logout')} size='xl' icon={RiLogoutCircleRLine}>
						{t('logout')}
					</IconButtonLink>
				</Card>
				<Card className='umbrel-divide-y overflow-hidden !py-0'>
					<ListRow title={t('account')} description={t('account-description')}>
						<div className='flex flex-wrap gap-2 pt-3'>
							<IconButtonLink to={'account/change-name'} icon={RiUserLine}>
								{t('change-name')}
							</IconButtonLink>
							<IconButtonLink to={'account/change-password'} icon={RiKeyLine}>
								{t('change-password')}
							</IconButtonLink>
							<IconButtonLink to={'sessions'} icon={RiComputerLine}>
								{t('sessions.title')}
							</IconButtonLink>
						</div>
					</ListRow>
					<ListRow
						title={t('wallpaper')}
						description={t('wallpaper-description')}
						isActive={settingsDialog === 'wallpaper'}
					>
						<div className='-mx-2 max-w-full'>
							<WallpaperPicker />
						</div>
					</ListRow>
					<ListRow title={t('2fa')} description={t('2fa-description')} disabled={is2faEnabledQ.isLoading}>
						<Switch checked={is2faEnabledQ.data} onCheckedChange={() => navigate('2fa')} />
					</ListRow>
				</Card>
			</div>
		</div>
	)
}
