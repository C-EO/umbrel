import type {TFunction} from 'i18next'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {toast} from '@/components/ui/toast'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {BackButton} from '@/routes/settings/_components/shared'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

// 3D accessory artwork shared by the settings panel and the approval notification
export const thunderboltAccessoryImage = '/assets/settings/thunderbolt-accessory.webp'

export function ThunderboltSettingsPanel({onBack}: {onBack: () => void}) {
	const {t} = useTranslation()
	const confirm = useConfirmation()
	const utils = trpcReact.useUtils()
	const devicesQ = trpcReact.hardware.thunderbolt.getDevices.useQuery(undefined, {
		// Events provide immediate updates; polling is a low-frequency fallback
		// in case a live subscription misses a change without reconnecting.
		refetchInterval: 30_000,
	})
	const authorizeMut = trpcReact.hardware.thunderbolt.authorize.useMutation()
	const revokeMut = trpcReact.hardware.thunderbolt.revoke.useMutation()

	// The device list changes from outside the UI (hot-plug, udev), so
	// live-update from the event bus while the panel is open
	const invalidateDevices = () => {
		utils.hardware.thunderbolt.getDevices.invalidate()
		utils.hardware.thunderbolt.getPendingDevices.invalidate()
	}
	trpcReact.eventBus.listen.useSubscription(
		{event: 'hardware:thunderbolt:devices-change'},
		{
			// Refetch on every (re)connect so a dropped websocket can't leave the
			// list frozen on a stale snapshot (onStarted fires on reconnect too)
			onStarted: invalidateDevices,
			onData: invalidateDevices,
			onError: (error) => console.error('hardware:thunderbolt:devices-change subscription error', error),
		},
	)

	const refresh = async () => {
		await Promise.all([
			utils.hardware.thunderbolt.getDevices.invalidate(),
			utils.hardware.thunderbolt.getPendingDevices.invalidate(),
			utils.notifications.get.invalidate(),
		])
	}

	const actionError = (error: unknown) => {
		const message = error instanceof Error ? error.message : t('unknown-error')
		toast.error(t('thunderbolt-settings.action-error', {message}), {
			icon: (
				<img src={thunderboltAccessoryImage} alt='' draggable={false} className='size-10 shrink-0 object-contain' />
			),
		})
	}

	const authorize = async (id: string) => {
		try {
			await authorizeMut.mutateAsync({id})
			await refresh()
		} catch (error) {
			actionError(error)
		}
	}

	const revoke = async (device: ThunderboltDevice) => {
		const deviceName = formatDeviceName(device, t('thunderbolt-settings.unknown-accessory'))
		// Remembered accessories are forgotten; session-only approvals have
		// nothing persisted, so the action is simply disconnecting
		const forget = device.remembered
		try {
			const result = await confirm({
				title: forget
					? t('thunderbolt-settings.forget-confirm-title', {device: deviceName})
					: t('thunderbolt-settings.disconnect-confirm-title', {device: deviceName}),
				message: forget
					? t('thunderbolt-settings.forget-confirm-description', {device: deviceName})
					: t('thunderbolt-settings.disconnect-confirm-description', {device: deviceName}),
				actions: [
					{
						label: forget ? t('thunderbolt-settings.forget') : t('thunderbolt-settings.disconnect'),
						value: 'confirm',
						variant: 'destructive',
					},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (result.actionValue !== 'confirm') return
		} catch {
			return
		}

		try {
			await revokeMut.mutateAsync({id: device.id})
			await refresh()
		} catch (error) {
			actionError(error)
		}
	}

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('advanced-settings')}</BackButton>
			<div className='space-y-1 px-1'>
				<h3 className='text-18 leading-tight font-semibold'>{t('thunderbolt-settings.title')}</h3>
				<p className='text-13 leading-tight text-white/45'>{t('thunderbolt-settings.panel-description')}</p>
			</div>

			{devicesQ.isLoading ? (
				<div className='flex min-h-36 items-center justify-center'>
					<TbLoader className='size-6 animate-spin opacity-50' aria-label={t('loading')} />
				</div>
			) : devicesQ.error ? (
				<div className='flex min-h-36 flex-col items-center justify-center gap-2 rounded-12 bg-destructive/10 p-6 text-center'>
					<img
						src={thunderboltAccessoryImage}
						alt=''
						draggable={false}
						className='size-12 object-contain opacity-30 grayscale'
					/>
					<div className='text-14 font-medium text-destructive2-lightest'>{t('thunderbolt-settings.load-error')}</div>
				</div>
			) : devicesQ.data?.length ? (
				<div className='flex flex-col gap-2'>
					{devicesQ.data.map((device) => {
						const isAuthorizing = authorizeMut.isPending && authorizeMut.variables?.id === device.id
						const isRevoking = revokeMut.isPending && revokeMut.variables?.id === device.id
						const deviceName = formatDeviceName(device, t('thunderbolt-settings.unknown-accessory'))
						return (
							<div key={device.id} className='flex items-center gap-3 rounded-12 bg-white/6 p-3.5'>
								<img
									src={thunderboltAccessoryImage}
									alt=''
									draggable={false}
									className={cn('size-10 shrink-0 object-contain', !device.connected && 'opacity-40 grayscale')}
								/>
								<div className='min-w-0 flex-1 space-y-1'>
									<h3 className='truncate text-13 leading-tight font-medium'>{deviceName}</h3>
									<div className='flex items-center gap-1.5 text-11 leading-tight text-white/35'>
										<span
											className={cn(
												'size-1.5 rounded-full',
												!device.connected
													? 'bg-white/40'
													: device.remembered || device.authorized
														? 'bg-success-light'
														: 'bg-amber-400',
											)}
										/>
										{deviceStatus(device, t)}
									</div>
								</div>
								{device.remembered || device.authorized ? (
									// Remembered accessories are forgotten; session-only approvals are
									// simply disconnected. Styled like the sessions Logout button; the
									// confirmation dialog carries the destructive styling.
									<Button size='sm' disabled={isRevoking} onClick={() => void revoke(device)}>
										{device.remembered
											? isRevoking
												? t('thunderbolt-settings.forgetting')
												: t('thunderbolt-settings.forget')
											: isRevoking
												? t('thunderbolt-settings.disconnecting')
												: t('thunderbolt-settings.disconnect')}
									</Button>
								) : (
									<Button
										size='sm'
										variant='primary'
										disabled={isAuthorizing}
										onClick={() => void authorize(device.id)}
									>
										{isAuthorizing ? t('thunderbolt-settings.allowing') : t('thunderbolt-settings.allow')}
									</Button>
								)}
							</div>
						)
					})}
				</div>
			) : (
				<div className='flex min-h-36 flex-col items-center justify-center gap-2 rounded-12 bg-white/4 p-6 text-center'>
					<img
						src={thunderboltAccessoryImage}
						alt=''
						draggable={false}
						className='size-12 object-contain opacity-30 grayscale'
					/>
					<div className='text-14 font-medium text-white/70'>{t('thunderbolt-settings.empty-title')}</div>
					<div className='max-w-72 text-12 leading-relaxed text-white/40'>
						{t('thunderbolt-settings.empty-description')}
					</div>
				</div>
			)}
		</div>
	)
}

type ThunderboltDevice = RouterOutput['hardware']['thunderbolt']['getDevices'][number]

function formatDeviceName(device: ThunderboltDevice, fallback: string) {
	return [device.vendor, device.name].filter(Boolean).join(' ') || fallback
}

function deviceStatus(device: ThunderboltDevice, t: TFunction) {
	if (device.remembered && device.connected) return t('thunderbolt-settings.status-approved-connected')
	if (device.remembered) return t('thunderbolt-settings.status-approved-disconnected')
	if (device.authorized) return t('thunderbolt-settings.status-connected-until-unplugged')
	return t('thunderbolt-settings.status-approval-required')
}
