// HDD RAID onboarding flow - kept intentionally large because it's a cohesive page flow
// (results -> FailSafe pairing -> optional SSD acceleration), rendered inside the design's
// onboarding modal card. Registration and the reboot-spanning progress UI live in setup.tsx.

import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {
	TbAlertCircleFilled,
	TbAlertTriangle,
	TbAlertTriangleFilled,
	TbCircleCheckFilled,
	TbDeviceFloppy,
	TbInfoCircle,
	TbShield,
	TbShieldOff,
} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Checkbox} from '@/components/ui/checkbox'
import {Spinner} from '@/components/ui/loading'
import {Switch} from '@/components/ui/switch'
import ssdChip from '@/features/storage/assets/ssd-chip.svg'
import {DriveIcon, SsdChip} from '@/features/storage/components/list-manager/drive-visuals'
import {primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {AccountCredentials} from '@/routes/onboarding/create-account'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

import {formatSize, StorageDevice, useDetectStorageDevices} from '../raid/use-raid-setup'
import {FoundDeviceCard, ModalShell, StepHeader} from './components'
import {HddRecoverExistingInstall} from './recover-existing-install'
import {getCandidates, HddRaidSetupConfig, planAcceleratorPair, planFailsafePairs} from './use-hdd-raid-onboarding'

type Step = 'results' | 'failsafe' | 'accelerate'

// Format bytes, but if 0, use the same unit as the reference value (e.g., "0TB" instead of "0B")
const formatSizeWithUnit = (bytes: number, referenceBytes: number) => {
	if (bytes === 0 && referenceBytes > 0) {
		const unit = formatSize(referenceBytes).replace(/[\d.]/g, '')
		return `0${unit}`
	}
	return formatSize(bytes)
}

// ============================================================================
// Sub-components
// ============================================================================

// Drive rendering inside a FailSafe column cell
function ColumnDrive({device, subtitle}: {device: StorageDevice; subtitle: string}) {
	return (
		<>
			<DriveIcon led='green' />
			<div className='flex w-full flex-col items-center gap-0.5 text-center'>
				<span className='max-w-full truncate text-[15px] font-medium text-white'>{device.name}</span>
				<span className='max-w-full truncate text-13 text-white/40'>{subtitle}</span>
			</div>
		</>
	)
}

// Pill sitting on the divider between the two halves of a column
function DividerPill({tone, children}: {tone: 'brand' | 'red'; children: React.ReactNode}) {
	return (
		<span
			className={cn(
				'absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-white shadow-md',
				tone === 'brand' ? 'bg-brand' : 'bg-[#FF3434]',
			)}
		>
			{children}
		</span>
	)
}

// A vertical column in the FailSafe visualization: header slot above, card with a top
// and bottom half separated by a divider carrying a pill/icon. `ratio` matches the
// designs: even halves for pairs, a taller top half in the per-drive (FailSafe off) view.
function Column({
	header,
	top,
	bottom,
	divider,
	broken,
	ratio = 'even',
	width = 'normal',
}: {
	header?: React.ReactNode
	top: React.ReactNode
	bottom: React.ReactNode
	divider?: React.ReactNode
	broken?: boolean
	ratio?: 'even' | 'storage-heavy'
	width?: 'normal' | 'narrow'
}) {
	return (
		<div className={cn('flex shrink-0 flex-col gap-2.5', width === 'narrow' ? 'w-[130px]' : 'w-[200px]')}>
			<div className='flex h-[22px] items-center justify-center gap-1.5'>{header}</div>
			<div
				className={cn(
					'flex flex-1 flex-col overflow-hidden rounded-2xl border',
					broken ? 'border-dashed border-[#FF3434]/60 bg-[#FF3434]/5' : 'border-white/6 bg-white/4',
				)}
			>
				<div
					className={cn(
						'flex flex-col items-center justify-center gap-2.5 px-4 py-6',
						ratio === 'storage-heavy' ? 'flex-[3]' : 'flex-1',
					)}
				>
					{top}
				</div>
				<div
					className={cn('relative w-full', broken ? 'border-t border-dashed border-[#FF3434]/40' : 'h-px bg-white/8')}
				>
					{divider}
				</div>
				<div
					className={cn(
						'flex flex-col items-center justify-center gap-1.5 px-4 py-6 text-center',
						ratio === 'storage-heavy' ? 'flex-[2]' : 'flex-1',
						broken && 'bg-[#3C1C1C]/30',
					)}
				>
					{bottom}
				</div>
			</div>
		</div>
	)
}

// The larger chip render used on the acceleration screen (bleeds off the card edge
// like the designs; the capacity badge stays a dynamic overlay)
function BigSsdChip({sizeLabel, className}: {sizeLabel: string; className?: string}) {
	return (
		<div className={cn('relative flex h-[72px] w-[120px] shrink-0 items-center justify-center', className)}>
			<img src={ssdChip} alt='' draggable={false} className='size-full object-fill' />
			<span className='absolute rounded-[7px] border border-white/15 bg-[#232326] px-3 py-1 text-[15px] font-semibold whitespace-nowrap text-white'>
				{sizeLabel}
			</span>
		</div>
	)
}

// A row inside the acceleration pair card: SSD label, name, size · serial, chip on the right
function SsdRow({device, label}: {device: StorageDevice; label: string}) {
	return (
		<div className='flex items-center justify-between gap-4 py-5 pl-6'>
			<div className='flex min-w-0 flex-col gap-0.5'>
				<span className='text-[11px] font-medium tracking-wide text-white/40'>{label}</span>
				<span className='truncate text-[15px] font-medium text-white'>{device.name}</span>
				<span className='truncate text-13 text-white/40'>
					{formatSize(device.roundedSize)} · {device.serial}
				</span>
			</div>
			<BigSsdChip sizeLabel={formatSize(device.roundedSize)} className='-mr-4' />
		</div>
	)
}

// Amber note about accelerator SSDs being permanent
function PermanentWarning({single}: {single?: boolean}) {
	const {t} = useTranslation()
	return (
		<div className='mx-auto flex items-center gap-2 rounded-lg bg-[#F5A623]/15 px-4 py-2.5 text-[13px] text-[#F5A623]'>
			<TbAlertTriangle className='size-4 shrink-0' />
			{single
				? t('onboarding.hdd-raid.accelerate.permanent-warning-single')
				: t('onboarding.hdd-raid.accelerate.permanent-warning')}
		</div>
	)
}

// Empty state when there are no (or not enough) SSDs: power off and add SSD(s)
function NoSsdCard({pair}: {pair: boolean}) {
	const {t} = useTranslation()
	const circles = pair ? [1, 2] : [1]
	return (
		<div className='flex flex-col items-center gap-1.5 rounded-2xl bg-white/4 px-6 py-14 text-center'>
			<div className='mb-3 flex'>
				{circles.map((number, i) => (
					<div
						key={number}
						className={cn(
							'flex size-14 items-center justify-center rounded-full bg-white/8 text-[11px] font-medium text-white/70 ring-4 ring-black/20',
							i > 0 && '-ml-2.5',
						)}
					>
						{t('onboarding.hdd-raid.accelerate.ssd-label', {number})}
					</div>
				))}
			</div>
			<span className='text-[15px] font-medium text-white'>
				{pair
					? t('onboarding.hdd-raid.accelerate.none-title-pair')
					: t('onboarding.hdd-raid.accelerate.none-title-single')}
			</span>
			<span className='text-[12px] text-white/40'>{t('onboarding.hdd-raid.accelerate.none-hint')}</span>
		</div>
	)
}

// ============================================================================
// Main flow
// ============================================================================

export default function HddRaidOnboarding() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	// Credentials passed from create-account via location.state (same pattern as the Pro
	// RAID flow: survives refresh, lost on direct URL navigation - then we redirect back)
	const credentials = location.state?.credentials as AccountCredentials | undefined

	const {devices, isDetecting, refetch} = useDetectStorageDevices()
	// A pre-existing umbrelOS RAID install on the attached drives gets a restore-or-erase
	// choice before we offer a fresh setup (same flow as Pro onboarding)
	const recoverableInstallQ = trpcReact.hardware.raid.hasRecoverableInstall.useQuery(undefined, {
		enabled: !!credentials,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Infinity,
	})
	const [setUpAsNew, setSetUpAsNew] = useState(false)
	const [pendingConfig, setPendingConfig] = useState<HddRaidSetupConfig | null>(null)
	const [step, setStep] = useState<Step>('results')
	// True while an explicit "Scan again" is in flight (the background poll doesn't set this)
	const [isRescanning, setIsRescanning] = useState(false)
	// null = derive the default from the detected drives; set once the user toggles
	const [failSafeChoice, setFailSafeChoice] = useState<boolean | null>(null)
	// null = derive the default (largest SSD); set once the user changes the selection
	const [ssdChoice, setSsdChoice] = useState<string[] | null>(null)
	const {shutdown} = useGlobalSystemState()

	// Redirect to create-account if credentials are missing
	useEffect(() => {
		if (!credentials) navigate('/onboarding/create-account', {replace: true})
	}, [credentials, navigate])

	// --- Derived state ---

	const {hdds, ssds} = getCandidates(devices)
	const {pairs, unpaired} = planFailsafePairs(hdds)
	const canEnableFailSafe = pairs.length >= 1
	// Recommended (and default on) when every drive can be paired
	const failSafeRecommended = canEnableFailSafe && unpaired.length === 0
	const failSafeEnabled = canEnableFailSafe && (failSafeChoice ?? failSafeRecommended)

	const totalDetectedBytes = [...hdds, ...ssds].reduce((sum, device) => sum + device.roundedSize, 0)
	const totalHddBytes = hdds.reduce((sum, device) => sum + device.roundedSize, 0)
	// Mirrors store one drive's worth of data per pair
	const pairBytes = pairs.reduce((sum, [drive]) => sum + drive.roundedSize, 0)
	const availableBytes = failSafeEnabled ? pairBytes : totalHddBytes
	const failsafeBytes = failSafeEnabled ? pairBytes : 0
	const inactiveBytes = failSafeEnabled ? unpaired.reduce((sum, device) => sum + device.roundedSize, 0) : 0

	// Accelerator candidates: FailSafe needs a mirrored pair of same-size SSDs,
	// Full Storage takes a single SSD (largest selected by default)
	const acceleratorPair = planAcceleratorPair(ssds)
	const largestSsd = [...ssds].sort((a, b) => b.roundedSize - a.roundedSize)[0]
	const selectedSsdIds = failSafeEnabled
		? acceleratorPair
			? [acceleratorPair[0].id!, acceleratorPair[1].id!]
			: []
		: (ssdChoice ?? (largestSsd ? [largestSsd.id!] : []))
	const acceleratorBytes = failSafeEnabled
		? (acceleratorPair?.[0].roundedSize ?? 0)
		: (ssds.find((device) => device.id === selectedSsdIds[0])?.roundedSize ?? 0)
	const hasSelection = selectedSsdIds.length > 0

	if (!credentials) return null

	if (isDetecting || recoverableInstallQ.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner size='6' />
			</div>
		)
	}

	// Offer restoring a detected previous install before any fresh-setup screens; "set up
	// as new" requires an explicit erase confirmation inside the recovery screen
	if (recoverableInstallQ.data && !setUpAsNew) {
		return <HddRecoverExistingInstall devices={[...hdds, ...ssds]} onSetUpAsNew={() => setSetUpAsNew(true)} />
	}

	// --- Actions ---

	// Rescan with a brief minimum spinner so the click visibly registers even when
	// the query returns instantly with no changes
	const handleScanAgain = async () => {
		setIsRescanning(true)
		try {
			await Promise.all([refetch(), sleep(600)])
		} finally {
			setIsRescanning(false)
		}
	}

	const handleFinish = (withAccelerator: boolean) => {
		const raidDevices = failSafeEnabled ? pairs.flatMap(([a, b]) => [a.id!, b.id!]) : hdds.map((device) => device.id!)
		const acceleratorDevices = withAccelerator && hasSelection ? selectedSsdIds : undefined
		const config: HddRaidSetupConfig = {
			raidDevices,
			raidType: failSafeEnabled ? 'failsafe' : 'storage',
			acceleratorDevices,
			stats: {
				driveCount: raidDevices.length,
				storageBytes: availableBytes,
				failsafeBytes,
				acceleratorBytes: acceleratorDevices ? acceleratorBytes : 0,
			},
		}
		setPendingConfig(config)
	}

	const devicesToErase = pendingConfig
		? devices.filter(
				(device) =>
					!!device.id &&
					[...pendingConfig.raidDevices, ...(pendingConfig.acceleratorDevices ?? [])].includes(device.id),
			)
		: []

	const eraseConfirmationDialog = (
		<AlertDialog open={!!pendingConfig} onOpenChange={(open) => !open && setPendingConfig(null)}>
			<AlertDialogContent>
				<AlertDialogHeader icon={TbAlertTriangleFilled}>
					<AlertDialogTitle>{t('onboarding.raid.recovery.set-up-new-dialog.title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('storage-manager.add-drives-erase-warning')}</AlertDialogDescription>
					<div className='umbrel-stable-gutter grid max-h-[320px] gap-2 overflow-y-auto pt-2 sm:grid-cols-2'>
						{devicesToErase.map((device) => (
							<FoundDeviceCard key={device.id} device={device} />
						))}
					</div>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						onClick={() => {
							if (!pendingConfig) return
							navigate('/onboarding/hdd-raid/setup', {state: {credentials, config: pendingConfig}})
						}}
					>
						{t('onboarding.raid.recovery.set-up-new-dialog.confirm')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	// --- Footer stats shared by the FailSafe and accelerate steps ---

	const storageStats = (
		<div className='flex flex-col gap-0.5'>
			<span className='text-[17px] font-semibold text-white/85'>
				{t('onboarding.raid.available-storage')} <span className='text-brand'>{formatSize(availableBytes)}</span>
			</span>
			<span className='text-13 text-white/50'>
				{t('onboarding.raid.failsafe')}{' '}
				<span className='font-medium text-white/85'>{formatSizeWithUnit(failsafeBytes, availableBytes)}</span>
				{inactiveBytes > 0 && (
					<>
						{' · '}
						{t('storage-manager.inactive')} <span className='text-[#FF3434]'>{formatSize(inactiveBytes)}</span>
					</>
				)}
			</span>
		</div>
	)

	// --- Step: detected storage results ---

	if (step === 'results') {
		return (
			<ModalShell
				footer={
					<>
						<span className='text-[17px] font-semibold text-white/85'>
							{t('onboarding.hdd-raid.total-detected')}{' '}
							<span className='text-brand'>{formatSize(totalDetectedBytes)}</span>
						</span>
						<div className='flex flex-wrap items-center gap-3'>
							<button className={secondaryButtonClasss} disabled={isRescanning} onClick={handleScanAgain}>
								<span className='flex items-center gap-1.5'>
									{isRescanning && <Spinner />}
									{t('onboarding.hdd-raid.scan-again')}
								</span>
							</button>
							<button {...primaryButtonProps} disabled={hdds.length === 0} onClick={() => setStep('failsafe')}>
								{t('onboarding.raid.continue')}
							</button>
						</div>
					</>
				}
			>
				<StepHeader title={t('onboarding.raid.storage')} subTitle={t('onboarding.hdd-raid.devices-found')} />
				{hdds.length === 0 && ssds.length === 0 ? (
					<div className='flex flex-col items-center gap-1 rounded-2xl bg-white/4 px-6 py-14 text-center'>
						<span className='text-[15px] font-medium text-white'>{t('onboarding.hdd-raid.no-drives')}</span>
						<span className='text-13 text-white/40'>{t('onboarding.hdd-raid.no-drives-instructions')}</span>
					</div>
				) : (
					<div className='grid gap-3 md:grid-cols-2'>
						{[...hdds, ...ssds].map((device) => (
							<FoundDeviceCard key={device.id} device={device} />
						))}
					</div>
				)}
			</ModalShell>
		)
	}

	// --- Step: FailSafe pairing ---

	if (step === 'failsafe') {
		const ratio = failSafeEnabled ? 'even' : 'storage-heavy'
		return (
			<ModalShell
				footer={
					<>
						{storageStats}
						<div className='flex flex-wrap items-center gap-3'>
							<button className={secondaryButtonClasss} onClick={() => setStep('results')}>
								{t('back')}
							</button>
							<button {...primaryButtonProps} onClick={() => setStep('accelerate')}>
								{failSafeEnabled ? t('onboarding.raid.continue') : t('onboarding.hdd-raid.continue-without-failsafe')}
							</button>
						</div>
					</>
				}
			>
				<StepHeader
					title={t('onboarding.raid.failsafe')}
					titleExtra={<TbInfoCircle className='size-[18px] text-white/40' />}
					subTitle={t('onboarding.hdd-raid.failsafe.subtitle')}
				/>

				{/* Toggle card */}
				<div className='flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3.5'>
					<div className='flex items-center gap-3'>
						<Switch checked={failSafeEnabled} onCheckedChange={setFailSafeChoice} disabled={!canEnableFailSafe} />
						<span className='text-[15px] text-white/85'>{t('onboarding.raid.failsafe.enable')}</span>
					</div>
					{failSafeRecommended && (
						<div className='flex items-center gap-1 rounded-full border border-brand/50 bg-brand/10 px-2.5 py-0.5'>
							<IoShieldHalf className='size-3.5 text-brand' />
							<span className='text-[12px] text-brand'>{t('onboarding.raid.recommended')}</span>
						</div>
					)}
				</div>

				<p className='text-13 text-white/50'>
					{canEnableFailSafe
						? t('onboarding.hdd-raid.failsafe.description')
						: t('onboarding.hdd-raid.failsafe.cant-enable')}
				</p>

				{/* Columns: legend + one column per pair (on) or per drive (off) */}
				<div className='overflow-x-auto pb-1'>
					<div className='mx-auto flex w-max min-w-full justify-center gap-3 md:min-h-[400px]'>
						{/* Legend column */}
						<Column
							width='narrow'
							ratio={ratio}
							top={
								<>
									<TbDeviceFloppy className='size-5 text-white/80' />
									<span className='text-[15px] font-medium text-white/85'>{t('onboarding.raid.storage-label')}</span>
								</>
							}
							bottom={
								<>
									<TbShield className='size-5 text-white/80' />
									<span className='text-[15px] font-medium text-white/85'>{t('onboarding.raid.failsafe')}</span>
								</>
							}
						/>

						{failSafeEnabled ? (
							<>
								{pairs.map(([top, bottom]) => (
									<Column
										key={top.id}
										header={
											<>
												<TbCircleCheckFilled className='size-4 text-brand' />
												<span className='text-[15px] font-semibold text-white/90'>{formatSize(top.roundedSize)}</span>
											</>
										}
										top={<ColumnDrive device={top} subtitle={top.serial} />}
										bottom={<ColumnDrive device={bottom} subtitle={bottom.serial} />}
										divider={
											<DividerPill tone='brand'>
												<IoShieldHalf className='size-3' />
												{t('onboarding.hdd-raid.failsafe.pair-pill')}
											</DividerPill>
										}
									/>
								))}
								{unpaired.map((device) => (
									<Column
										key={device.id}
										broken
										header={
											<>
												<TbAlertCircleFilled className='size-4 text-[#FF3434]' />
												<span className='text-[15px] font-semibold text-white/90'>
													{formatSize(device.roundedSize)}
												</span>
											</>
										}
										top={<ColumnDrive device={device} subtitle={device.serial} />}
										bottom={
											<>
												<span className='text-[15px] font-medium text-white'>
													{t('storage-manager.pair-placeholder', {size: formatSize(device.roundedSize)})}
												</span>
												<span className='text-[12px] leading-snug text-white/40'>
													{t('onboarding.hdd-raid.failsafe.above-inactive')}
												</span>
											</>
										}
										divider={
											<DividerPill tone='red'>
												<TbShieldOff className='size-3' />
												{t('onboarding.hdd-raid.failsafe.no-pair-available')}
											</DividerPill>
										}
									/>
								))}
							</>
						) : (
							hdds.map((device) => (
								<Column
									key={device.id}
									ratio='storage-heavy'
									top={
										<ColumnDrive device={device} subtitle={`${formatSize(device.roundedSize)} · ${device.serial}`} />
									}
									bottom={<span className='text-[15px] text-white/40'>{t('onboarding.hdd-raid.failsafe.none')}</span>}
									divider={
										<span className='absolute top-1/2 left-1/2 z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#39393B]'>
											<TbShieldOff className='size-3.5 text-white/60' />
										</span>
									}
								/>
							))
						)}
					</div>
				</div>
			</ModalShell>
		)
	}

	// --- Step: SSD acceleration (optional) ---

	const canContinueWithAccelerator = failSafeEnabled ? !!acceleratorPair : hasSelection

	return (
		<ModalShell
			footer={
				<>
					{storageStats}
					<div className='flex flex-wrap items-center gap-3'>
						<button className={secondaryButtonClasss} onClick={() => setStep('failsafe')}>
							{t('back')}
						</button>
						{failSafeEnabled ? (
							acceleratorPair ? (
								<>
									<button className={secondaryButtonClasss} onClick={() => handleFinish(false)}>
										{t('onboarding.hdd-raid.accelerate.continue-without')}
									</button>
									<button {...primaryButtonProps} onClick={() => handleFinish(true)}>
										{t('onboarding.raid.continue')}
									</button>
								</>
							) : (
								<>
									<button className={secondaryButtonClasss} onClick={() => handleFinish(false)}>
										{t('onboarding.hdd-raid.accelerate.skip-continue')}
									</button>
									<button {...primaryButtonProps} onClick={() => shutdown()}>
										{t('onboarding.hdd-raid.accelerate.power-off')}
									</button>
								</>
							)
						) : (
							<button {...primaryButtonProps} onClick={() => handleFinish(hasSelection)}>
								{t('onboarding.hdd-raid.finish')}
							</button>
						)}
					</div>
				</>
			}
		>
			<StepHeader
				title={t('onboarding.hdd-raid.accelerate.title')}
				titleExtra={
					<span className='text-[18px] font-semibold text-white/40'>
						· {t('onboarding.hdd-raid.accelerate.optional')}
					</span>
				}
				subTitle={
					failSafeEnabled
						? t('onboarding.hdd-raid.accelerate.description')
						: t('onboarding.hdd-raid.accelerate.description-single')
				}
			/>
			<div className='border-t border-white/8' />

			{failSafeEnabled ? (
				// FailSafe: the accelerator must be a mirrored pair of same-size SSDs
				acceleratorPair ? (
					<>
						<p className='text-center text-[14px] text-white/85'>{t('onboarding.hdd-raid.accelerate.select-pair')}</p>
						<div className='mx-auto w-full max-w-[600px] overflow-hidden rounded-2xl bg-white/5'>
							<SsdRow device={acceleratorPair[0]} label={t('onboarding.hdd-raid.accelerate.ssd-label', {number: 1})} />
							<div className='relative h-px w-full bg-white/8'>
								<DividerPill tone='brand'>
									<IoShieldHalf className='size-3' />
									{t('onboarding.hdd-raid.accelerate.selected-pair')}
								</DividerPill>
							</div>
							<SsdRow device={acceleratorPair[1]} label={t('onboarding.hdd-raid.accelerate.ssd-label', {number: 2})} />
						</div>
						<PermanentWarning />
					</>
				) : ssds.length > 0 ? (
					<>
						<p className='text-center text-[14px] text-white/85'>{t('onboarding.hdd-raid.accelerate.select-pair')}</p>
						<div className='mx-auto w-full max-w-[600px] overflow-hidden rounded-2xl border border-dashed border-[#FF3434]/60 bg-[#FF3434]/5'>
							<SsdRow device={largestSsd} label={t('onboarding.hdd-raid.accelerate.ssd-label', {number: 1})} />
							<div className='relative w-full border-t border-dashed border-[#FF3434]/40'>
								<DividerPill tone='red'>
									<TbShieldOff className='size-3' />
									{t('onboarding.hdd-raid.accelerate.no-pair-title')}
								</DividerPill>
							</div>
							<div className='flex flex-col items-center gap-1.5 bg-[#3C1C1C]/30 px-6 py-10 text-center'>
								<span className='text-[15px] font-medium text-white'>
									{t('onboarding.hdd-raid.accelerate.add-matching-ssd')}
								</span>
								<span className='text-[12px] leading-relaxed text-white/40'>
									{t('onboarding.hdd-raid.accelerate.no-pair-note-mirrored')}
									<br />
									{t('onboarding.hdd-raid.accelerate.no-pair-note-larger')}
								</span>
							</div>
						</div>
					</>
				) : (
					<>
						<NoSsdCard pair />
						<PermanentWarning />
					</>
				)
			) : // Full Storage: a single SSD accelerates the pool
			ssds.length > 0 ? (
				<>
					<p className='text-center text-[14px] text-white/85'>{t('onboarding.hdd-raid.accelerate.select-single')}</p>
					{ssds.map((device) => {
						const selected = selectedSsdIds.includes(device.id!)
						return (
							<label
								key={device.id}
								className={cn(
									'mx-auto flex w-full max-w-[360px] cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border bg-white/5 py-3.5 pl-4 transition-colors',
									selected ? 'border-white/30' : 'border-white/10 hover:border-white/20',
								)}
							>
								<Checkbox checked={selected} onCheckedChange={() => setSsdChoice(selected ? [] : [device.id!])} />
								<div className='min-w-0 flex-1'>
									<div className='truncate text-[15px] font-medium text-white'>{device.name}</div>
									<div className='truncate text-13 text-white/40'>
										{formatSize(device.roundedSize)} · {device.serial}
									</div>
								</div>
								<BigSsdChip sizeLabel={formatSize(device.roundedSize)} className='-mr-6 h-[56px] w-[94px]' />
							</label>
						)
					})}
					{hasSelection && <PermanentWarning single />}
				</>
			) : (
				<>
					<NoSsdCard pair={false} />
					<PermanentWarning single />
				</>
			)}
			{eraseConfirmationDialog}
		</ModalShell>
	)
}
