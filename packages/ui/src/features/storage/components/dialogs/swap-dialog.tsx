import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangle, TbInfoCircle} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {toast} from '@/components/ui/toast'
import {useActiveRaidOperation} from '@/features/storage/hooks/use-active-raid-operation'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {cn} from '@/lib/utils'

import {StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize} from '../../utils'
import {OperationInProgressBanner} from './operation-in-progress-banner'
import {ProInstallInstructions} from './pro-install-instructions'
import {ShutdownConfirmationDialog} from './shutdown-confirmation-dialog'

type SwapDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	raidType?: 'storage' | 'failsafe'
	/** Umbrel Pro slot of the device being swapped */
	slot?: number | null
	/** Device id of the device being swapped - used on devices without physical slots */
	oldDeviceId?: string | null
	/** Whether the device being swapped has failed (pool degraded) - adjusts title and banner */
	oldDeviceFailed?: boolean
	/** Wording hint for a swapped member whose physical device is missing (no type to read) */
	missingDeviceType?: 'ssd' | 'hdd'
	isUmbrelPro: boolean
	raidDriveCount: number
	availableDevices: StorageDevice[]
	allDevices: StorageDevice[]
	replaceDeviceAsync: (params: {oldDevice: string; newDevice: string}) => Promise<boolean>
}

export function SwapDialog({
	open,
	onOpenChange,
	raidType,
	slot = null,
	oldDeviceId = null,
	oldDeviceFailed = false,
	missingDeviceType,
	isUmbrelPro,
	raidDriveCount,
	availableDevices,
	allDevices,
	replaceDeviceAsync,
}: SwapDialogProps) {
	const {t} = useTranslation()
	const {setPendingOperation, clearPendingOperation} = usePendingRaidOperation()

	// Check if a RAID operation is already in progress
	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null)
	const [showShutdownConfirmation, setShowShutdownConfirmation] = useState(false)

	const deviceName = isUmbrelPro ? t('storage-manager.umbrel-pro') : t('storage-manager.device')
	const isStorageMode = raidType === 'storage'
	const maxSlots = 4
	// Only Umbrel Pro has a fixed number of physical slots
	const hasFreeSlot = isUmbrelPro ? raidDriveCount < maxSlots : true

	// Get the device being replaced (needed for size validation)
	const oldDevice = slot
		? allDevices.find((d) => d.slot === slot)
		: oldDeviceId
			? allDevices.find((d) => d.id === oldDeviceId)
			: null

	// Copy variants: dialogs opened via slot describe SSDs (Umbrel Pro), otherwise word
	// choice follows the swapped device's type (HDD pools say drive, accelerator SSDs and
	// SSD pools keep SSD wording).
	// dv('storage-manager.swap.foo') resolves to 'storage-manager.swap.foo-drive' when generic.
	const isGenericDrive = !slot && (oldDevice ? oldDevice.type !== 'ssd' : missingDeviceType !== 'ssd')
	const dv = (key: string) => t(isGenericDrive ? `${key}-drive` : key)
	// "SSD" slot labels are not translated - they match the physical device markings
	const swappedLabel = slot ? `SSD ${slot}` : isGenericDrive ? t('storage-manager.swap.drive-label') : 'SSD'
	const swappedLabelDefinite = slot
		? `SSD ${slot}`
		: isGenericDrive
			? t('storage-manager.swap.the-old-drive')
			: t('storage-manager.swap.the-old-ssd')

	// SATA devices sit in drive bays which are hot-swappable on most NAS hardware, so the
	// shutdown steps become an "only if your bays aren't hot-swappable" note. NVMe devices
	// (and Umbrel Pro's slots) keep the explicit shutdown steps.
	const canHotSwap = !isUmbrelPro && oldDevice?.transport === 'sata'

	// Filter available devices to only show those large enough for replacement.
	// ZFS requires replacement devices to be at least as large as the device being replaced.
	// We compare roundedSize (not raw size) because the backend partitions devices using roundedSize,
	// so ZFS validates based on partition sizes which are determined by roundedSize.
	const validReplacementDevices = oldDevice
		? availableDevices.filter((d) => (d.roundedSize ?? d.size) >= (oldDevice.roundedSize ?? oldDevice.size))
		: availableDevices

	const hasAvailableDevices = availableDevices.length > 0

	// Initialize selection when dialog opens, reset when it closes
	// Note: validReplacementDevices intentionally omitted from deps - it's a new array ref each render,
	// and we only want to auto-select once when the dialog opens, not reset on every render
	useEffect(() => {
		if (open) {
			setSelectedReplacementId(validReplacementDevices.length === 1 ? (validReplacementDevices[0].id ?? null) : null)
		} else {
			setShowShutdownConfirmation(false)
			setSelectedReplacementId(null)
		}
	}, [open])

	// Storage mode with free slot AND available devices - we show replacement selection.
	// Requires an attached old device: without it there is no size validation and the
	// confirm could never enable, so missing members fall through to the instructions.
	if (isStorageMode && hasFreeSlot && hasAvailableDevices && oldDevice) {
		const selectedDevice = validReplacementDevices.find((d) => d.id === selectedReplacementId)

		const handleReplace = () => {
			if (!selectedDevice?.id || !oldDevice?.id) return

			// Replace is non-blocking - we show island immediately
			setPendingOperation({
				type: 'replace',
				state: 'starting',
				progress: 0,
			})
			onOpenChange(false)

			replaceDeviceAsync({
				oldDevice: oldDevice.id,
				newDevice: selectedDevice.id,
			}).catch((error) => {
				clearPendingOperation()
				toast.error(t('storage-manager.swap.failed-to-start'), {
					area: 'settings',
					description: error instanceof Error ? error.message : t('unknown-error'),
				})
			})
		}

		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent onOpenAutoFocus={(e) => e.preventDefault()}>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>
								{t('storage-manager.replace')} {swappedLabel}
							</DialogTitle>
							<DialogDescription>{dv('storage-manager.swap.description-replace')}</DialogDescription>
						</DialogHeader>

						{oldDeviceFailed ? (
							/* Full Storage has no redundancy - a failed member means data is already at
							   risk, so don't promise a lossless copy */
							<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
								<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-destructive2'>
										{isGenericDrive
											? t('storage-manager.replace-failed.degraded-storage-drive')
											: t('storage-manager.replace-failed.degraded-storage')}
									</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.failed-description-storage')}</span>
								</div>
							</div>
						) : (
							/* Info banner */
							<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
								<TbInfoCircle className='mt-0.5 size-5 shrink-0 text-brand' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-brand'>{t('storage-manager.swap.no-data-loss')}</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.no-data-loss-description')}</span>
								</div>
							</div>
						)}

						{/* Drive selection - show all available, disable those too small */}
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>{dv('storage-manager.swap.select-new-ssd')}</span>
							<div className='flex flex-col gap-2'>
								{availableDevices.map((device) => {
									const isSelected = selectedReplacementId === device.id
									const isTooSmall = oldDevice
										? (device.roundedSize ?? device.size) < (oldDevice.roundedSize ?? oldDevice.size)
										: false
									return (
										<button
											key={device.id}
											type='button'
											onClick={() => !isTooSmall && setSelectedReplacementId(device.id ?? null)}
											disabled={isTooSmall}
											className={cn(
												'flex items-center gap-3 rounded-12 border p-3 text-left transition-colors',
												isTooSmall
													? 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-60'
													: isSelected
														? 'border-brand bg-brand/10'
														: 'border-white/10 bg-white/5 hover:bg-white/8',
											)}
										>
											<div
												className={cn(
													'flex size-5 items-center justify-center rounded-full border-2',
													isTooSmall ? 'border-white/20' : isSelected ? 'border-brand bg-brand' : 'border-white/30',
												)}
											>
												{isSelected && !isTooSmall && <div className='size-2 rounded-full bg-white' />}
											</div>
											<div className='flex flex-1 flex-col gap-0.5'>
												{/* "SSD" and "Slot" labels are not translated - they match the physical device markings.
												    Devices without physical slots show size and model instead. */}
												<span className={cn('text-13 font-medium', isTooSmall ? 'text-white/50' : 'text-white')}>
													{device.slot
														? t('storage-manager.swap.ssd-in-slot', {
																size: formatStorageSize(device.size),
																slot: device.slot,
															})
														: `${formatStorageSize(device.size)} · ${device.model}`}
												</span>
												{device.name && (
													<span className={cn('text-12', isTooSmall ? 'text-white/30' : 'text-white/40')}>
														{device.name}
													</span>
												)}
											</div>
											{isTooSmall && (
												<span className='shrink-0 text-11 font-medium text-[#F5A623]'>
													{t('storage-manager.swap.too-small', {
														size: formatStorageSize(oldDevice?.roundedSize ?? oldDevice?.size ?? 0),
													})}
												</span>
											)}
										</button>
									)
								})}
							</div>
						</div>

						{/* What happens next */}
						<div className='flex flex-col gap-2'>
							<span className='text-13 font-medium text-white/60'>{t('storage-manager.swap.what-happens-next')}</span>
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{[
									dv('storage-manager.swap.step-data-copied'),
									t('storage-manager.swap.step-may-take-while'),
									canHotSwap
										? t('storage-manager.swap.step-remove-old-hot-swap', {ssd: swappedLabelDefinite})
										: t('storage-manager.swap.step-remove-old', {ssd: swappedLabelDefinite}),
								].map((step, index) => (
									<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
										<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
											{index + 1}
										</span>
										<span>{step}</span>
									</div>
								))}
							</div>
						</div>

						{isOperationInProgress && <OperationInProgressBanner variant='wait' />}

						<DialogFooter>
							<Button
								variant='primary'
								onClick={handleReplace}
								disabled={!selectedDevice || !oldDevice || isOperationInProgress}
							>
								{t('storage-manager.replace')}
							</Button>
							<Button variant='default' onClick={() => onOpenChange(false)}>
								{t('cancel')}
							</Button>
						</DialogFooter>
					</div>
				</DialogScrollableContent>
			</Dialog>
		)
	}

	// Storage mode with free slot but NO available devices - we show "add a drive first" instructions.
	// Umbrel Pro gets the installation photo with prose instead of a step list.
	if (isStorageMode && hasFreeSlot) {
		// The re-entry step names the button that reopens this dialog, which reads Replace
		// for a failed member and Swap otherwise (matching the title above)
		const returnStep = oldDeviceFailed
			? t('storage-manager.swap.step-return-to-replace')
			: t('storage-manager.swap.step-return-to-swap')
		// Hot-swappable bays skip the shutdown/power-on steps in favor of a note
		const steps = canHotSwap
			? [
					dv('storage-manager.swap.step-power-off-if-needed'),
					dv('storage-manager.swap.step-insert-new-ssd'),
					returnStep,
				]
			: [
					t('storage-manager.swap.step-shut-down', {deviceName}),
					dv('storage-manager.swap.step-insert-new-ssd'),
					t('storage-manager.swap.step-power-on', {deviceName}),
					returnStep,
				]

		return (
			<>
				<Dialog open={open} onOpenChange={onOpenChange}>
					<DialogScrollableContent onOpenAutoFocus={(e) => e.preventDefault()}>
						<div className='flex flex-col gap-5 p-5'>
							<DialogHeader>
								<DialogTitle>
									{oldDeviceFailed ? t('storage-manager.replace') : t('storage-manager.swap')} {swappedLabel}
								</DialogTitle>
								<DialogDescription>{t('storage-manager.swap.description-full-storage')}</DialogDescription>
							</DialogHeader>

							{oldDeviceFailed ? (
								/* The member has failed (or is missing entirely) - no safe-swap promises */
								<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
									<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
									<div className='flex flex-col gap-1'>
										<span className='text-13 font-semibold text-destructive2'>
											{isGenericDrive
												? t('storage-manager.replace-failed.degraded-storage-drive')
												: t('storage-manager.replace-failed.degraded-storage')}
										</span>
										<span className='text-12 text-white/60'>
											{dv('storage-manager.swap.failed-description-storage')}
										</span>
									</div>
								</div>
							) : (
								/* Info banner */
								<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
									<TbInfoCircle className='mt-0.5 size-5 shrink-0 text-brand' />
									<div className='flex flex-col gap-1'>
										<span className='text-13 font-semibold text-brand'>
											{t('storage-manager.swap.safe-swap-available')}
										</span>
										<span className='text-12 text-white/60'>{dv('storage-manager.swap.safe-swap-description')}</span>
									</div>
								</div>
							)}

							{isUmbrelPro ? (
								<ProInstallInstructions
									paragraphs={[
										t('storage-manager.swap.pro-instructions-insert-1'),
										t('storage-manager.swap.pro-instructions-insert-2'),
									]}
								/>
							) : (
								<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
									{steps.map((step, index) => (
										<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
											<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
												{index + 1}
											</span>
											<span>{step}</span>
										</div>
									))}
								</div>
							)}

							{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

							<DialogFooter>
								<Button variant='primary' onClick={() => setShowShutdownConfirmation(true)}>
									{t('shut-down')}
								</Button>
								<Button variant='default' onClick={() => onOpenChange(false)}>
									{t('cancel')}
								</Button>
							</DialogFooter>
						</div>
					</DialogScrollableContent>
				</Dialog>

				<ShutdownConfirmationDialog open={showShutdownConfirmation} onOpenChange={setShowShutdownConfirmation} />
			</>
		)
	}

	if (isStorageMode) {
		// No free slot because all 4 slots are in use - you would need to use backup, factory reset, and restore workflow
		// "SSD" slot labels are not translated - they match the physical device markings
		const ssdLabel = slot ? `SSD ${slot}` : t('storage-manager.swap.the-old-ssd')
		const steps = [
			{
				title: t('storage-manager.swap.step-backup'),
				description: t('storage-manager.swap.step-backup-description'),
			},
			{
				title: t('storage-manager.swap.step-factory-reset'),
				description: t('storage-manager.swap.step-factory-reset-description', {deviceName}),
			},
			{
				title: t('storage-manager.swap.step-shut-down-and-swap', {ssd: ssdLabel}),
				description: isUmbrelPro
					? t('storage-manager.swap.step-shut-down-and-swap-description-pro')
					: t('storage-manager.swap.step-shut-down-and-swap-description-other'),
			},
			{
				title: t('storage-manager.swap.step-setup-new-storage'),
				description: t('storage-manager.swap.step-setup-new-storage-description', {deviceName}),
			},
			{
				title: t('storage-manager.swap.step-restore'),
				description: t('storage-manager.swap.step-restore-description'),
			},
		]

		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
					<DialogHeader>
						{/* "SSD" slot labels are not translated - they match the physical device markings */}
						<DialogTitle>
							{t('storage-manager.swap')} {slot ? `SSD ${slot}` : 'SSD'}
						</DialogTitle>
						<DialogDescription>{t('storage-manager.swap.description-no-free-slot')}</DialogDescription>
					</DialogHeader>

					{/* Warning banner */}
					<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
						<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
						<div className='flex flex-col gap-1'>
							<span className='text-13 font-semibold text-destructive2'>
								{t('storage-manager.swap.data-will-be-erased')}
							</span>
							<span className='text-12 text-white/60'>
								{t('storage-manager.swap.data-erased-description', {deviceName})}
							</span>
						</div>
					</div>

					{/* Steps */}
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{steps.map((step, index) => (
							<div key={index} className='flex items-start gap-3 p-3'>
								<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
									{index + 1}
								</span>
								<div className='flex flex-col gap-0.5'>
									<span className='text-12 font-semibold text-white'>{step.title}</span>
									<span className='text-12 text-white/50'>{step.description}</span>
								</div>
							</div>
						))}
					</div>

					<DialogFooter>
						<Button variant='default' onClick={() => onOpenChange(false)}>
							{t('done')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		)
	}

	// FailSafe mode. Umbrel Pro gets the installation photo with prose instead of a step
	// list; hot-swappable bays skip the shutdown/power-on steps in favor of a note.
	const steps = canHotSwap
		? [
				dv('storage-manager.swap.step-power-off-if-needed'),
				t('storage-manager.swap.step-swap-ssd', {ssd: swappedLabelDefinite}),
				dv('storage-manager.swap.step-return-to-storage-manager'),
			]
		: [
				t('storage-manager.swap.step-shut-down', {deviceName}),
				t('storage-manager.swap.step-swap-ssd', {ssd: swappedLabelDefinite}),
				t('storage-manager.swap.step-power-on', {deviceName}),
				dv('storage-manager.swap.step-return-to-storage-manager'),
			]

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>
								{oldDeviceFailed ? t('storage-manager.replace') : t('storage-manager.swap')} {swappedLabel}
							</DialogTitle>
							<DialogDescription>{t('storage-manager.swap.description-failsafe')}</DialogDescription>
						</DialogHeader>

						{oldDeviceFailed ? (
							/* The drive has failed - be honest that protection is reduced until it's swapped */
							<div className='flex items-start gap-3 rounded-12 bg-destructive2/10 p-3'>
								<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-destructive2' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-destructive2'>
										{t('storage-manager.replace-failed.degraded')}
									</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.failed-description')}</span>
								</div>
							</div>
						) : (
							/* Proactive swap of a healthy drive - FailSafe keeps the data safe throughout */
							<div className='flex items-start gap-3 rounded-12 bg-brand/10 p-3'>
								<IoShieldHalf className='mt-0.5 size-5 shrink-0 text-brand' />
								<div className='flex flex-col gap-1'>
									<span className='text-13 font-semibold text-brand'>{t('storage-manager.swap.data-protected')}</span>
									<span className='text-12 text-white/60'>{dv('storage-manager.swap.data-protected-description')}</span>
								</div>
							</div>
						)}

						{isUmbrelPro ? (
							<ProInstallInstructions
								paragraphs={[
									t('storage-manager.swap.pro-instructions-swap-1', {ssd: swappedLabelDefinite}),
									t('storage-manager.swap.pro-instructions-swap-2'),
								]}
							/>
						) : (
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{steps.map((step, index) => (
									<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
										<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
											{index + 1}
										</span>
										<span>{step}</span>
									</div>
								))}
							</div>
						)}

						{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

						<DialogFooter>
							<Button variant='primary' onClick={() => setShowShutdownConfirmation(true)}>
								{t('shut-down')}
							</Button>
							<Button variant='default' onClick={() => onOpenChange(false)}>
								{t('cancel')}
							</Button>
						</DialogFooter>
					</div>
				</DialogScrollableContent>
			</Dialog>

			<ShutdownConfirmationDialog open={showShutdownConfirmation} onOpenChange={setShowShutdownConfirmation} />
		</>
	)
}
