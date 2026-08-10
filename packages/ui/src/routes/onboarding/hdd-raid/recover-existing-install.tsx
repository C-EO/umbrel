import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangleFilled, TbCircleCheckFilled, TbDatabase} from 'react-icons/tb'

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
import {Spinner} from '@/components/ui/loading'
import {primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'

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
					<AlertDialogAction variant='destructive' onClick={onSetUpAsNew}>
						{t('onboarding.raid.recovery.set-up-new-dialog.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	// Restore in progress: the device reboots and the hook redirects to `/` when it's back
	if (restoreRequested && !restoreFailed) {
		return (
			<ModalShell>
				<StepHeader
					title={t('onboarding.raid.recovery.restoring.title')}
					subTitle={t('onboarding.raid.recovery.restoring.subtitle')}
				/>
				<div className='flex flex-1 flex-col items-center justify-center gap-4'>
					<Spinner size='6' />
					<p className='max-w-[400px] text-center text-sm text-white/50'>
						{t('onboarding.raid.recovery.restoring.warning')}
					</p>
				</div>
			</ModalShell>
		)
	}

	if (restoreFailed) {
		return (
			<ModalShell>
				<div className='flex flex-1 flex-col items-center justify-center gap-4 px-4'>
					<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
					<h1 className='text-[20px] font-bold text-white/90'>{t('onboarding.raid.recovery.failed.title')}</h1>
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
					<span className='text-[15px] font-semibold text-brand'>
						{t('onboarding.raid.recovery.found.storage-detected')}
					</span>
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
				subTitle={t('onboarding.raid.recovery.found.subtitle')}
			/>

			{/* Existing install summary */}
			<div className='flex max-w-[560px] items-start gap-3 rounded-xl bg-white/5 p-4'>
				<div className='relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15'>
					<TbDatabase className='size-5 text-brand' />
					<TbCircleCheckFilled className='absolute -right-0.5 -bottom-0.5 size-3.5 text-brand' />
				</div>
				<div className='flex flex-col gap-1'>
					<p className='text-[15px] font-medium text-white/85'>{t('onboarding.raid.recovery.found.install-title')}</p>
					<p className='text-[13px] leading-relaxed text-white/50'>
						{t('onboarding.raid.recovery.found.install-description')}
					</p>
				</div>
			</div>

			{/* Detected drives */}
			<div className='grid gap-3 md:grid-cols-2'>
				{devices.map((device) => (
					<FoundDeviceCard key={device.id} device={device} />
				))}
			</div>

			<p className='max-w-[560px] text-[13px] leading-relaxed text-white/50'>
				{t('onboarding.raid.recovery.found.sign-in-note')}
			</p>

			{setUpAsNewDialog}
		</ModalShell>
	)
}
