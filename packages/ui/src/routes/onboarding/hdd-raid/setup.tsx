// HDD RAID setup progress page. Registration triggers the pool build and a reboot, so
// this page (like the Pro raid/setup route) has no EnsureUserDoesntExist guard: after
// the reboot the backend creates the user from saved credentials while we keep polling
// until setup completes, then show the launch screen and auto-login.

import {useEffect, useRef, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {TbAlertTriangleFilled} from 'react-icons/tb'
import {Link, useLocation, useNavigate} from 'react-router-dom'

import {Spinner} from '@/components/ui/loading'
import {links} from '@/constants/links'
import {primaryButtonProps} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'

import {formatSize} from '../raid/use-raid-setup'
import {ModalShell, StepHeader} from './components'
import {HddRaidSetupConfig} from './use-hdd-raid-onboarding'

// The stat tiles shown on the "Your setup" and launch screens
function SetupStats({
	stats,
	failSafe,
	storageLabel,
}: {
	stats: HddRaidSetupConfig['stats']
	failSafe: boolean
	storageLabel: string
}) {
	const {t} = useTranslation()
	const tiles: {value: string; label: string}[] = [
		{value: String(stats.driveCount), label: t('onboarding.hdd-raid.setup.hard-drives-added')},
		{value: formatSize(stats.storageBytes), label: storageLabel},
	]
	if (failSafe)
		tiles.push({value: formatSize(stats.failsafeBytes), label: t('onboarding.hdd-raid.setup.space-for-failsafe')})
	if (stats.acceleratorBytes > 0)
		tiles.push({value: formatSize(stats.acceleratorBytes), label: t('onboarding.hdd-raid.setup.ssd-for-acceleration')})

	return (
		<div className='grid w-full grid-cols-2 gap-3 md:grid-cols-4'>
			{tiles.map((tile) => (
				<div key={tile.label} className='flex flex-col gap-1 rounded-xl bg-white/5 p-4'>
					<span className='text-[20px] font-semibold text-white/90'>{tile.value}</span>
					<span className='text-[12px] text-white/40'>{tile.label}</span>
				</div>
			))}
		</div>
	)
}

export default function HddRaidSetup() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	const credentials = location.state?.credentials as AccountCredentials | undefined
	const config = location.state?.config as HddRaidSetupConfig | undefined

	const [phase, setPhase] = useState<'setting-up' | 'restarting' | 'complete' | 'error'>('setting-up')
	const [isLaunching, setIsLaunching] = useState(false)

	const auth = useAuth()
	const {suppressErrors, shutdown} = useGlobalSystemState()

	// Poll for RAID setup completion after reboot: true (complete), false (in progress),
	// or throws (failed). Network errors are expected while the device reboots.
	const raidStatusQ = trpcReact.hardware.raid.checkInitialRaidSetupStatus.useQuery(undefined, {
		enabled: phase === 'restarting',
		refetchInterval: phase === 'restarting' ? 2000 : false,
		retry: false,
	})

	useEffect(() => {
		if (phase !== 'restarting') return
		if (raidStatusQ.data === true) setPhase('complete')
		if (raidStatusQ.isError) {
			const errorMessage = raidStatusQ.error?.message ?? ''
			const isNetworkError = errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')
			if (!isNetworkError) setPhase('error')
		}
	}, [phase, raidStatusQ.data, raidStatusQ.isError, raidStatusQ.error])

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (token) => auth.signUpWithToken(token, '/'),
		onError: () => {
			window.location.href = '/'
		},
	})

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: () => setPhase('restarting'),
		onError: () => setPhase('error'),
	})

	const register = () => {
		if (!credentials || !config) return
		// Suppress global system state errors before the expected reboot downtime
		suppressErrors()
		setPhase('setting-up')
		registerMut.mutate({
			name: credentials.name,
			password: credentials.password,
			language: credentials.language,
			raidDevices: config.raidDevices,
			raidType: config.raidType,
			acceleratorDevices: config.acceleratorDevices,
		})
	}

	// Register exactly once on mount; the previous step's Continue is the user's confirmation
	const startedRef = useRef(false)
	useEffect(() => {
		if (!credentials || !config) {
			navigate('/onboarding/create-account', {replace: true})
			return
		}
		if (startedRef.current) return
		startedRef.current = true
		register()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	if (!credentials || !config) return null

	// --- Error state ---
	if (phase === 'error') {
		const canRetry = !!registerMut.error // Only pre-reboot errors can be retried
		const errorMessage = registerMut.error?.message || raidStatusQ.error?.message
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-4'>
				<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
				<h1
					className='text-[20px] font-bold text-white/85'
					style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
				>
					{t('onboarding.raid.setup-failed.title')}
				</h1>
				<p className='max-w-[300px] text-center text-[15px] text-white/70'>{errorMessage}</p>
				<p className='max-w-[300px] text-center text-[13px] text-white/50'>
					{canRetry
						? t('onboarding.raid.setup-failed.description-retry')
						: t('onboarding.raid.setup-failed.description-no-retry')}
				</p>
				<div className='flex gap-3'>
					{canRetry && (
						<button
							onClick={() => {
								registerMut.reset()
								register()
							}}
							className={primaryButtonProps.className}
							style={primaryButtonProps.style}
						>
							{t('onboarding.raid.try-again')}
						</button>
					)}
					<button
						onClick={() => shutdown()}
						className='flex h-[42px] min-w-[112px] items-center justify-center rounded-full bg-destructive2 px-4 text-14 font-medium text-white ring-destructive2/40 transition-all duration-300 hover:bg-destructive2-lighter focus:outline-hidden focus-visible:ring-3 active:scale-100 active:bg-destructive2 disabled:pointer-events-none disabled:opacity-50'
						style={{boxShadow: '0px 2px 4px 0px rgba(255, 255, 255, 0.25) inset'}}
					>
						{t('shut-down')}
					</button>
				</div>
			</div>
		)
	}

	// --- Launch state ---
	if (phase === 'complete') {
		const firstName = credentials.name?.split(' ')[0] || ''
		return (
			<ModalShell>
				<div className='flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center'>
					<h1 className='text-[28px] font-bold text-white/90 md:text-[32px]'>
						{t('onboarding.account-created.youre-all-set-name', {name: firstName})}
					</h1>
					<p className='max-w-[420px] text-[14px] leading-relaxed text-white/40'>
						<Trans
							t={t}
							i18nKey='onboarding.account-created.by-clicking-button-you-agree'
							components={{
								linked: <Link to={links.legal.tos} className={linkClass} target='_blank' />,
							}}
						/>
					</p>
					<div className='mt-4 w-full max-w-[760px]'>
						<SetupStats
							stats={config.stats}
							failSafe={config.raidType === 'failsafe'}
							storageLabel={t('onboarding.raid.available-storage')}
						/>
					</div>
					<button
						onClick={() => {
							setIsLaunching(true)
							loginMut.mutate({password: credentials.password, totpToken: ''})
						}}
						disabled={isLaunching}
						className={`mt-4 ${primaryButtonProps.className}`}
						style={primaryButtonProps.style}
					>
						{isLaunching ? t('onboarding.raid.launching') : t('onboarding.launch-umbrelos')}
					</button>
				</div>
			</ModalShell>
		)
	}

	// --- Progress state ---
	return (
		<ModalShell>
			<StepHeader title={t('onboarding.hdd-raid.setup.title')} />
			<div className='border-t border-white/8' />
			<SetupStats
				stats={config.stats}
				failSafe={config.raidType === 'failsafe'}
				storageLabel={t('onboarding.hdd-raid.setup.space-for-storage')}
			/>
			<div className='flex flex-1 flex-col items-center justify-center gap-4'>
				<div className='flex items-center gap-2.5 text-[17px] font-medium text-white/85'>
					<Spinner size='5' />
					{t('onboarding.raid.configuring.title')}
				</div>
				<p className='max-w-[400px] text-center text-sm text-white/50'>{t('onboarding.raid.configuring.warning')}</p>
			</div>
		</ModalShell>
	)
}
