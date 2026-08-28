import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangleFilled} from 'react-icons/tb'

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
import {Layout, primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {Progress} from '@/modules/bare/progress'

import type {RaidOnboardingVariant} from './index'
import {SsdHealthDialog, useSsdHealthDialog} from './ssd-health-dialog'
import {GenericSsdTray, SsdSlot, SsdTray} from './ssd-tray'
import {formatSize, getDeviceHealth, StorageDevice} from './use-raid-setup'
import {useRecoverExistingInstall} from './use-recover-existing-install'

type RecoverExistingInstallProps = {
	devices: StorageDevice[]
	variant?: RaidOnboardingVariant
	onSetUpAsNew: () => void
}

export function RecoverExistingInstall({devices, variant = 'pro', onSetUpAsNew}: RecoverExistingInstallProps) {
	const {t} = useTranslation()
	const isGeneric = variant === 'generic'
	const healthDialog = useSsdHealthDialog()
	const [showSetUpAsNewDialog, setShowSetUpAsNewDialog] = useState(false)

	const {handleRestore, restoreRequested, restoreFailed, errorMessage} = useRecoverExistingInstall()

	const proSlots: (SsdSlot | null)[] = [null, null, null, null]
	devices.forEach((device) => {
		const slotIndex = (device.slot ?? 0) - 1
		if (slotIndex >= 0 && slotIndex < proSlots.length) {
			proSlots[slotIndex] = {
				size: formatSize(device.roundedSize),
				hasWarning: getDeviceHealth(device).hasWarning,
			}
		}
	})
	const genericSlots: SsdSlot[] = devices.map((device) => ({
		size: formatSize(device.roundedSize),
		hasWarning: getDeviceHealth(device).hasWarning,
		label: device.name,
	}))

	const setUpAsNewDialog = (
		<AlertDialog open={showSetUpAsNewDialog} onOpenChange={setShowSetUpAsNewDialog}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('onboarding.raid.recovery.set-up-new-dialog.title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('onboarding.raid.recovery.set-up-new-dialog.description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction onClick={onSetUpAsNew}>
						{t('onboarding.raid.recovery.set-up-new-dialog.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	if (restoreRequested && !restoreFailed) {
		return (
			<Layout
				title={t('onboarding.raid.recovery.restoring.title')}
				subTitle={t('onboarding.raid.recovery.restoring.subtitle')}
				subTitleMaxWidth={430}
				showLogo={false}
				footer={
					<div className='w-full max-w-sm'>
						<p className='text-center text-sm text-white/60'>{t('onboarding.raid.recovery.restoring.warning')}</p>
					</div>
				}
			>
				{!isGeneric && (
					<>
						<img
							src='/assets/onboarding/pro-front.webp'
							alt={t('storage-manager.umbrel-pro')}
							draggable={false}
							className='w-64 md:w-96'
						/>
						<p className='-mt-4 text-[13px] font-medium text-white/30'>{t('storage-manager.umbrel-pro')}</p>
					</>
				)}
				<div className='mt-4 w-full max-w-sm'>
					<Progress />
				</div>
			</Layout>
		)
	}

	if (restoreFailed) {
		const failedMessage = errorMessage ?? t('onboarding.raid.recovery.failed.description')

		return (
			<>
				<div className='flex flex-1 flex-col items-center justify-center gap-4 px-4'>
					<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
					<h1
						className='text-[20px] font-bold text-white/85'
						style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
					>
						{t('onboarding.raid.recovery.failed.title')}
					</h1>
					<p className='max-w-[360px] text-center text-[15px] text-white/70'>{failedMessage}</p>
					<div className='flex flex-col gap-3 sm:flex-row'>
						<button onClick={handleRestore} {...primaryButtonProps}>
							{t('onboarding.raid.try-again')}
						</button>
						<button
							onClick={() => setShowSetUpAsNewDialog(true)}
							className={`${secondaryButtonClasss} w-full sm:w-fit`}
						>
							{t('onboarding.raid.recovery.set-up-new')}
						</button>
					</div>
				</div>
				{setUpAsNewDialog}
			</>
		)
	}

	return (
		<div className='flex flex-1 flex-col md:flex-row'>
			<div className='flex flex-1 flex-col justify-center gap-5 px-4 py-6 md:pr-0 md:pl-6'>
				<div className='flex flex-col gap-1 md:gap-2'>
					<h1
						className='text-[20px] font-bold text-white/85 md:text-[24px]'
						style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
					>
						{t('onboarding.raid.recovery.found.title')}
					</h1>
					<p className='max-w-[500px] text-[14px] text-white/50 md:text-[16px]'>
						{t('onboarding.raid.recovery.found.subtitle')}
					</p>
				</div>

				<div className='flex flex-col gap-3 sm:flex-row'>
					<button
						onClick={handleRestore}
						{...primaryButtonProps}
						className={`${primaryButtonProps.className} w-full sm:w-fit`}
					>
						{t('onboarding.raid.recovery.restore')}
					</button>
					<button onClick={() => setShowSetUpAsNewDialog(true)} className={`${secondaryButtonClasss} w-full sm:w-fit`}>
						{t('onboarding.raid.recovery.set-up-new')}
					</button>
				</div>
			</div>

			<div
				className={`hidden min-w-0 flex-1 flex-col justify-center md:flex ${isGeneric ? 'items-center' : 'items-end md:-mr-6'}`}
			>
				{/* The bottom fade suits the Pro chassis photo; the generic enclosure is a bounded card */}
				<div
					className={isGeneric ? 'w-full' : 'w-[95%]'}
					style={
						isGeneric
							? undefined
							: {
									maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
									WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
								}
					}
				>
					{isGeneric ? (
						<GenericSsdTray
							slots={genericSlots}
							onHealthClick={(deviceIndex) => {
								const device = devices[deviceIndex]
								if (device) healthDialog.openDialog(device)
							}}
						/>
					) : (
						<SsdTray
							slots={proSlots}
							onHealthClick={(slotIndex) => {
								const device = devices.find((candidate) => candidate.slot === slotIndex + 1)
								if (device) healthDialog.openDialog(device, slotIndex + 1)
							}}
						/>
					)}
				</div>
			</div>

			{setUpAsNewDialog}

			{healthDialog.selectedDevice && (
				<SsdHealthDialog
					device={healthDialog.selectedDevice.device}
					slotNumber={healthDialog.selectedDevice.slotNumber}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
				/>
			)}
		</div>
	)
}
