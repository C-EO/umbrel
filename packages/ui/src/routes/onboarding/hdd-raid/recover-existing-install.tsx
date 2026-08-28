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

import {StorageDevice} from '../raid/use-raid-setup'
import {useRecoverExistingInstall} from '../raid/use-recover-existing-install'
import {FoundDeviceCard, ModalShell, StepHeader} from './components'

// HDD-flow variant of the Pro recovery screen: same backend flow and copy, rendered in
// the HDD onboarding's modal card with drive rows instead of the Pro SSD tray.
export function HddRecoverExistingInstall({
	devices,
	onSetUpAsNew,
}: {
	devices: StorageDevice[]
	onSetUpAsNew: () => void
}) {
	const {t} = useTranslation()
	const [showSetUpAsNewDialog, setShowSetUpAsNewDialog] = useState(false)
	const {handleRestore, restoreRequested, restoreFailed, errorMessage} = useRecoverExistingInstall()

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

	// Restore in progress: the device reboots and the hook redirects to `/` when it's back.
	// Same restoring cover as the SSD RAID recovery flow.
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
				<div className='mt-4 w-full max-w-sm'>
					<Progress />
				</div>
			</Layout>
		)
	}

	if (restoreFailed) {
		return (
			<ModalShell>
				<div className='flex flex-1 flex-col items-center justify-center gap-4 px-4'>
					<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
					<h1
						className='text-[20px] font-bold text-white/85'
						style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
					>
						{t('onboarding.raid.recovery.failed.title')}
					</h1>
					<p className='max-w-[360px] text-center text-[15px] text-white/70'>
						{errorMessage ?? t('onboarding.raid.recovery.failed.description')}
					</p>
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
			</ModalShell>
		)
	}

	return (
		<ModalShell
			footer={
				<>
					{/* Empty span keeps the justify-between footer's actions on the right */}
					<span />
					<div className='flex flex-wrap items-center gap-3'>
						<button onClick={() => setShowSetUpAsNewDialog(true)} className={secondaryButtonClasss}>
							{t('onboarding.raid.recovery.set-up-new')}
						</button>
						<button onClick={handleRestore} {...primaryButtonProps}>
							{t('onboarding.raid.recovery.restore')}
						</button>
					</div>
				</>
			}
		>
			<StepHeader
				title={t('onboarding.raid.recovery.found.title')}
				subTitle={t('onboarding.raid.recovery.found.subtitle-drive')}
			/>

			{/* Detected drives */}
			<div className='grid gap-3 md:grid-cols-2'>
				{devices.map((device) => (
					<FoundDeviceCard key={device.id} device={device} />
				))}
			</div>

			{setUpAsNewDialog}
		</ModalShell>
	)
}
