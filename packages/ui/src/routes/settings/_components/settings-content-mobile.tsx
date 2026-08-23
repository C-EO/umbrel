import {ChevronRight} from 'lucide-react'
import {motion, useReducedMotion} from 'motion/react'
import {ComponentType, Fragment, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {PiCircuitryBold, PiHardDriveFill, PiPulseBold, PiThermometerSimpleBold} from 'react-icons/pi'
import {Link, useNavigate} from 'react-router-dom'

import {BetaPill} from '@/components/ui/beta-pill'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {Card} from '@/components/ui/card'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {Separator} from '@/components/ui/separator'
import {SETTINGS_SYSTEM_CARDS_ID} from '@/constants'
import {getDeviceHealth} from '@/features/storage/hooks/use-storage'
import {useCpuTemperature} from '@/hooks/use-cpu-temperature'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {DesktopPreviewConnected, DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {WifiListRowConnectedDescription} from '@/modules/wifi/wifi-list-row-connected-description'
import {useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {useWallpaper} from '@/providers/wallpaper'
import {SettingsSummary} from '@/routes/settings/_components/settings-summary'
import {trpcReact} from '@/trpc/trpc'
import {firstNameFromFullName} from '@/utils/misc'

import {CpuCardContent} from './cpu-card-content'
import {CpuTemperatureCardContent} from './cpu-temperature-card-content'
import {ListRowMobile, ListRowSwitchIndicator} from './list-row'
import {MemoryCardContent} from './memory-card-content'
import {createSettingsCatalog, getSettingsPage, SettingsPageItem} from './settings-catalog'
import {SettingsItemsGroup, SettingsSearch} from './settings-page-controls'
import {useSettingsFilterLabels} from './settings-taxonomy'
import {SettingsAccountAvatar} from './shared'
import {StorageCardContent} from './storage-card-content'

const statCardClass = 'settings-edge-material h-full min-h-[104px] !rounded-24 !p-4'
const mobileActionButtonClass = 'settings-edge-material h-9 min-w-0 flex-1 rounded-full px-2 text-12 whitespace-nowrap'

function getSheetScrollViewport(element: HTMLElement | null) {
	return element?.closest<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null
}

export function SettingsContentMobile({isMember = false}: {isMember?: boolean}) {
	const {t} = useTranslation()
	const filterLabels = useSettingsFilterLabels()
	const {addLinkSearchParams} = useQueryParams()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const cpuTemperature = useCpuTemperature({enabled: !isMember})
	const wifiSupportedQ = trpcReact.wifi.supported.useQuery(undefined, {enabled: !isMember})
	const wifiQ = trpcReact.wifi.connected.useQuery(undefined, {enabled: !isMember && wifiSupportedQ.data === true})
	const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery(undefined, {enabled: isMember})
	const {deviceName} = useIsHomeOrPro()
	const {wallpaper} = useWallpaper()
	const {setHideCloseButton} = useSheetStickyHeader()
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {enabled: !isMember})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		enabled: !isMember,
	})

	const [searchQuery, setSearchQuery] = useState('')
	const [controlsStuck, setControlsStuck] = useState(false)
	const isContentReady = Boolean(userQ.data)
	const controlsRef = useRef<HTMLDivElement>(null)
	const scrollFrameRef = useRef<number | null>(null)

	const hasRaidIssue = raidStatusQ.data?.exists && raidStatusQ.data?.status && raidStatusQ.data?.status !== 'ONLINE'
	const hasHealthIssue = devicesQ.data?.some((device) => getDeviceHealth(device).hasWarning)
	const hasStorageIssue = hasRaidIssue || hasHealthIssue
	const ownerFirstName = userQ.data?.name ? firstNameFromFullName(userQ.data.name) : ''
	const ownerHeading = ownerFirstName ? `${ownerFirstName}’s ${t('umbrel')}` : t('umbrel')
	const settingsCatalog = useMemo(
		() => createSettingsCatalog(t, {deviceName, isMember, memberName: userQ.data?.name}),
		[t, deviceName, isMember, userQ.data?.name],
	)
	const settingsPage = useMemo(
		() => getSettingsPage(settingsCatalog, {query: searchQuery, filter: 'all'}),
		[settingsCatalog, searchQuery],
	)

	const desktopPreview = useMemo(
		() => (
			<DesktopPreviewFrame>
				<DesktopPreviewConnected />
			</DesktopPreviewFrame>
		),
		[],
	)

	useEffect(() => {
		const scrollViewport = getSheetScrollViewport(controlsRef.current)
		if (!scrollViewport) return

		const updateStickyControls = () => {
			if (scrollFrameRef.current !== null) return

			scrollFrameRef.current = requestAnimationFrame(() => {
				scrollFrameRef.current = null
				const controlsElement = controlsRef.current
				if (!controlsElement) return

				// Batch all layout reads into this animation frame; the raw passive scroll
				// listener does no measuring or state updates.
				const viewportTop = scrollViewport.getBoundingClientRect().top
				const controlsRect = controlsElement.getBoundingClientRect()
				const nextControlsStuck = scrollViewport.scrollTop > 0 && controlsRect.top <= viewportTop + 1
				setControlsStuck((current) => (current === nextControlsStuck ? current : nextControlsStuck))
			})
		}

		scrollViewport.addEventListener('scroll', updateStickyControls, {passive: true})
		window.addEventListener('resize', updateStickyControls, {passive: true})
		updateStickyControls()
		return () => {
			scrollViewport.removeEventListener('scroll', updateStickyControls)
			window.removeEventListener('resize', updateStickyControls)
			if (scrollFrameRef.current !== null) {
				cancelAnimationFrame(scrollFrameRef.current)
				scrollFrameRef.current = null
			}
		}
	}, [isContentReady])

	useLayoutEffect(() => {
		setHideCloseButton(controlsStuck)
		return () => setHideCloseButton(false)
	}, [controlsStuck, setHideCloseButton])

	const renderSettingsItem = (item: SettingsPageItem) => {
		const navigateToItem = () => {
			if (item.id === 'wifi' && wifiSupportedQ.data === false) navigate('/settings/wifi-unsupported')
			else if (item.external) window.open(item.to, '_blank', 'noopener,noreferrer')
			else navigate(item.to)
		}
		let title: ReactNode = item.title
		let description: ReactNode = item.description
		let trailing = <MobileChevron />
		let disabled = false

		if (item.id === '2fa') {
			disabled = is2faEnabledQ.isLoading
			trailing = <ListRowSwitchIndicator checked={is2faEnabledQ.data ?? false} />
		} else if (item.id === 'wifi') {
			disabled = wifiSupportedQ.isLoading || (wifiSupportedQ.data === true && wifiQ.isLoading)
			if (wifiQ.data?.status === 'connected') {
				description = <WifiListRowConnectedDescription network={wifiQ.data} />
			}
		} else if (item.id === 'storage') {
			title = (
				<span className='flex items-center gap-1.5'>
					{item.title}
					{hasStorageIssue && (
						<span className='relative size-2' role='img' aria-label={t('storage-manager.health.title')}>
							<span className='absolute inset-0 rounded-full bg-[#FF3434]' />
							<span className='absolute inset-0 animate-ping rounded-full bg-[#FF3434] opacity-75' />
						</span>
					)}
				</span>
			)
		} else if (item.id === 'mcp') {
			title = (
				<span className='flex items-center gap-1.5'>
					{item.title}
					<BetaPill />
				</span>
			)
		}

		return (
			<ListRowMobile
				icon={item.icon}
				title={title}
				description={description}
				disabled={disabled}
				onClick={navigateToItem}
			>
				{trailing}
			</ListRowMobile>
		)
	}

	if (!userQ.data) return null

	return (
		<div className='flex animate-in flex-col gap-5 pb-8 fade-in'>
			<div className='flex flex-col items-center gap-4 px-1'>
				<div className='relative isolate'>
					{wallpaper.id && (
						<img
							src={`/assets/wallpapers/generated-small/${wallpaper.id}.jpg`}
							alt=''
							aria-hidden='true'
							className='pointer-events-none absolute top-5 left-1/2 -z-10 h-[154px] w-[260px] -translate-x-1/2 translate-y-5 scale-[0.96] rounded-10 object-cover opacity-65 blur-[22px] saturate-150'
						/>
					)}
					<div className='relative z-10'>{desktopPreview}</div>
					<SettingsAccountAvatar
						name={userQ.data.name}
						userId={userQ.data.userId}
						avatarUrl={userQ.data.avatarUrl}
						controlsVisibility='always'
					/>
				</div>
				<h2
					title={ownerHeading}
					aria-label={ownerHeading}
					className='flex w-full min-w-0 items-center justify-center gap-1 overflow-hidden py-2 text-24 leading-none font-semibold -tracking-4'
				>
					{ownerFirstName && <span className='min-w-0 truncate'>{ownerFirstName}’s</span>}
					<span className='shrink-0 text-white/45'>{t('umbrel')}</span>
				</h2>
			</div>

			<SettingsSummary />

			<div className='flex items-center gap-2'>
				<ButtonLink to={{search: addLinkSearchParams({dialog: 'logout'})}} className={mobileActionButtonClass}>
					{t('logout')}
				</ButtonLink>
				{isMember ? (
					<>
						<Button disabled className={mobileActionButtonClass}>
							{t('restart')}
						</Button>
						<Button disabled text='destructive' className={mobileActionButtonClass}>
							{t('shut-down')}
						</Button>
					</>
				) : (
					<>
						<ButtonLink to={{search: addLinkSearchParams({dialog: 'restart'})}} className={mobileActionButtonClass}>
							{t('restart')}
						</ButtonLink>
						<ButtonLink
							to={{search: addLinkSearchParams({dialog: 'shutdown'})}}
							text='destructive'
							className={mobileActionButtonClass}
						>
							{t('shut-down')}
						</ButtonLink>
					</>
				)}
			</div>
			<Separator />

			{!isMember && (
				<div className='grid grid-cols-2 gap-2.5'>
					<Link to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'storage'})}}>
						<MobileStatCardTap>
							<Card className={statCardClass}>
								<StorageCardContent headerIcon={<MobileStatIcon icon={PiHardDriveFill} />} />
							</Card>
						</MobileStatCardTap>
					</Link>
					<Link to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'memory'})}}>
						<MobileStatCardTap>
							<Card id={SETTINGS_SYSTEM_CARDS_ID} className={statCardClass}>
								<MemoryCardContent headerIcon={<MobileStatIcon icon={PiCircuitryBold} />} />
							</Card>
						</MobileStatCardTap>
					</Link>
					<Link to={{search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'cpu'})}}>
						<MobileStatCardTap>
							<Card className={statCardClass}>
								<CpuCardContent headerIcon={<MobileStatIcon icon={PiPulseBold} />} />
							</Card>
						</MobileStatCardTap>
					</Link>
					<Card className={cn('group/temperature-card', statCardClass)}>
						<CpuTemperatureCardContent
							headerIcon={<MobileStatIcon icon={PiThermometerSimpleBold} />}
							warning={cpuTemperature.warning}
							temperatureInCelcius={cpuTemperature.temperature}
						/>
					</Card>
				</div>
			)}

			<div
				ref={controlsRef}
				data-testid='mobile-settings-controls'
				data-settings-rail-stuck={controlsStuck ? 'true' : 'false'}
				className={cn(
					'sticky top-0 z-30 -mx-3 -mb-4 flex items-center justify-between gap-2 px-3 py-3 transition-[background-color,box-shadow] duration-200',
					controlsStuck && 'border-b border-white/8 shadow-[0_12px_24px_rgba(0,0,0,0.22)]',
				)}
				style={{
					backgroundColor: controlsStuck
						? 'color-mix(in srgb, hsl(var(--color-brand)) 14%, #03080b 86%)'
						: 'transparent',
				}}
			>
				<SettingsSearch
					value={searchQuery}
					onChange={setSearchQuery}
					label={t('search')}
					className='w-full min-w-0 shrink'
				/>
				{controlsStuck && <DialogCloseButton className='shrink-0' />}
			</div>

			<div className='flex flex-col gap-4'>
				{settingsPage.categoryIds.map((categoryId) => (
					<SettingsItemsGroup key={categoryId} id={categoryId} label={filterLabels[categoryId]}>
						{settingsPage.itemsByCategory[categoryId].map((item) => (
							<Fragment key={item.id}>{renderSettingsItem(item)}</Fragment>
						))}
					</SettingsItemsGroup>
				))}
				{settingsPage.items.length === 0 && (
					<div className='rounded-24 bg-white/4 px-6 py-12 text-center text-14 text-white/45'>
						{t('settings.no-results', {query: searchQuery})}
					</div>
				)}
			</div>
		</div>
	)
}

function MobileChevron() {
	return <ChevronRight className='size-4 text-white/45' aria-hidden='true' />
}

// Tap-only feedback: hover states stick on touch, so no whileHover here
function MobileStatCardTap({children}: {children: ReactNode}) {
	const reduceMotion = Boolean(useReducedMotion())
	return (
		<motion.div
			className='h-full will-change-transform'
			whileTap={reduceMotion ? undefined : {scale: 0.96}}
			transition={{type: 'spring', duration: 0.2, bounce: 0.15}}
		>
			{children}
		</motion.div>
	)
}

function MobileStatIcon({icon: Icon}: {icon: ComponentType<{className?: string}>}) {
	return (
		<div
			data-testid='mobile-stat-icon'
			aria-hidden='true'
			className='flex size-5 shrink-0 items-center justify-center text-white'
		>
			<Icon className='size-[18px]' />
		</div>
	)
}
