import {Loader2, Maximize2, Pin, Power, RotateCw, Volume2, VolumeX, X} from 'lucide-react'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {MachineMenu, useUninstallMachine} from '@/features/machines/components/machines-list'
import {machineFullscreenPath, machineRailButtonClass, machineStopTextClass} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

// Floating control rail next to the machine screen (power/restart/fullscreen/pin/menu/close)
export function MachineRail({machine, onClose}: {machine: Machine; onClose?: () => void}) {
	const {start, stop, restart, retryInstall, setPinned} = useMachineActions()
	const {muted, setMuted} = useMachineAudioPreference(machine.id)
	const cancelInstall = useUninstallMachine(machine)

	const isBusy = machine.state === 'starting' || machine.state === 'stopping' || machine.state === 'restarting'

	return (
		<div
			// Beside the display (xl+) the rail slides in from the right; when it
			// wraps below the display on smaller screens it just fades in
			className='flex w-full shrink-0 animate-in flex-row flex-wrap justify-center gap-3 delay-150 duration-300 fill-mode-backwards fade-in xl:w-auto xl:flex-col xl:flex-nowrap xl:justify-start xl:slide-in-from-right-6'
		>
			<DarkTooltip label={t('machines.open-fullscreen')} side='left'>
				<a
					href={machineFullscreenPath(machine.id)}
					target='_blank'
					rel='noreferrer'
					className={machineRailButtonClass}
					aria-label={t('machines.open-fullscreen')}
				>
					<Maximize2 className='size-5' />
				</a>
			</DarkTooltip>
			<DarkTooltip label={muted ? t('machines.console-enable-audio') : t('machines.console-mute-audio')} side='left'>
				<button
					className={cn(machineRailButtonClass, muted && 'text-white/45')}
					onClick={() => setMuted(!muted)}
					aria-label={muted ? t('machines.console-enable-audio') : t('machines.console-mute-audio')}
				>
					{muted ? <VolumeX className='size-5' /> : <Volume2 className='size-5' />}
				</button>
			</DarkTooltip>
			<DarkTooltip
				label={machine.pinned ? t('machines.unpin-from-homescreen') : t('machines.pin-to-homescreen')}
				side='left'
			>
				<button
					className={cn(machineRailButtonClass, machine.pinned && 'bg-white/20 hover:bg-white/25')}
					onClick={() => setPinned({id: machine.id, pinned: !machine.pinned})}
					aria-label={machine.pinned ? t('machines.unpin-from-homescreen') : t('machines.pin-to-homescreen')}
				>
					<Pin className={cn('size-5', machine.pinned && 'fill-current')} />
				</button>
			</DarkTooltip>
			<DarkTooltip label={t('machines.restart')} side='left'>
				<button
					className={machineRailButtonClass}
					onClick={() => restart({id: machine.id})}
					disabled={machine.state !== 'running'}
					aria-label={t('machines.restart')}
				>
					<RotateCw className='size-5' />
				</button>
			</DarkTooltip>
			{machine.state === 'installing' ? (
				<>
					<button className={machineRailButtonClass} disabled aria-label={t('machines.state.installing')}>
						<Loader2 className='size-5 animate-spin' />
					</button>
					<DarkTooltip label={t('machines.cancel-install')} side='left'>
						<button
							className={machineRailButtonClass}
							onClick={cancelInstall}
							aria-label={t('machines.cancel-install')}
						>
							<X className={cn('size-5', machineStopTextClass)} />
						</button>
					</DarkTooltip>
				</>
			) : machine.state === 'stopped' || machine.state === 'error' ? (
				<DarkTooltip
					label={
						machine.state === 'error' && machine.installPending
							? t('machines.retry-install')
							: machine.state === 'error'
								? t('machines.turn-on-again')
								: t('machines.turn-on')
					}
					side='left'
				>
					<button
						className={machineRailButtonClass}
						onClick={() =>
							machine.state === 'error' && machine.installPending
								? retryInstall({id: machine.id})
								: start({id: machine.id})
						}
						aria-label={
							machine.state === 'error' && machine.installPending ? t('machines.retry-install') : t('machines.turn-on')
						}
					>
						<Power className='size-5' />
					</button>
				</DarkTooltip>
			) : (
				<DarkTooltip label={isBusy ? t(`machines.state.${machine.state}`) : t('machines.shut-down')} side='left'>
					<button
						className={machineRailButtonClass}
						onClick={() => stop({id: machine.id})}
						disabled={machine.state !== 'running'}
						aria-label={t('machines.shut-down')}
					>
						{isBusy ? (
							<Loader2 className='size-5 animate-spin' />
						) : (
							<Power className={cn('size-5', machineStopTextClass)} />
						)}
					</button>
				</DarkTooltip>
			)}
			<MachineMenu machine={machine} buttonClassName={machineRailButtonClass} />
			{onClose && (
				<DarkTooltip label={t('close')} side='left'>
					<button className={cn(machineRailButtonClass, 'hidden md:flex')} onClick={onClose} aria-label={t('close')}>
						<X className='size-5' />
					</button>
				</DarkTooltip>
			)}
		</div>
	)
}
