import {Loader2, Maximize2, Pin, Power, RotateCw, Volume2, VolumeX, X} from 'lucide-react'
import {motion} from 'motion/react'

import {MachineMenu, useUninstallMachine} from '@/features/machines/components/machines-list'
import {MachinesTooltip} from '@/features/machines/components/machines-tooltip'
import {machineFullscreenPath, machineRailButtonClass, machineStopTextClass} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

// Floating control rail next to the machine screen (power/restart/fullscreen/pin/menu)
export function MachineRail({machine}: {machine: Machine}) {
	const {start, stop, restart, retryInstall, setPinned} = useMachineActions()
	const {muted, setMuted} = useMachineAudioPreference(machine.id)
	const cancelInstall = useUninstallMachine(machine)

	const isBusy = machine.state === 'starting' || machine.state === 'stopping' || machine.state === 'restarting'

	return (
		<motion.div
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			transition={{delay: 0.15, duration: 0.2, ease: 'easeOut'}}
			className='flex w-full shrink-0 flex-row flex-wrap justify-center gap-3 xl:w-auto xl:flex-col xl:flex-nowrap xl:justify-start'
		>
			<MachinesTooltip
				label={muted ? t('machines.console-enable-audio') : t('machines.console-mute-audio')}
				side='left'
			>
				<button
					className={cn(machineRailButtonClass, muted && 'text-white/45')}
					onClick={() => setMuted(!muted)}
					aria-label={muted ? t('machines.console-enable-audio') : t('machines.console-mute-audio')}
				>
					{muted ? <VolumeX className='size-5' /> : <Volume2 className='size-5' />}
				</button>
			</MachinesTooltip>
			<MachinesTooltip label={t('machines.open-fullscreen')} side='left'>
				<a
					href={machineFullscreenPath(machine.id)}
					target='_blank'
					rel='noreferrer'
					className={machineRailButtonClass}
					aria-label={t('machines.open-fullscreen')}
				>
					<Maximize2 className='size-5' />
				</a>
			</MachinesTooltip>
			<MachinesTooltip
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
			</MachinesTooltip>
			<MachinesTooltip label={t('machines.restart')} side='left'>
				<button
					className={machineRailButtonClass}
					onClick={() => restart({id: machine.id})}
					disabled={machine.state !== 'running'}
					aria-label={t('machines.restart')}
				>
					<RotateCw className='size-5' />
				</button>
			</MachinesTooltip>
			{machine.state === 'installing' ? (
				<>
					<button className={machineRailButtonClass} disabled aria-label={t('machines.state.installing')}>
						<Loader2 className='size-5 animate-spin' />
					</button>
					<MachinesTooltip label={t('machines.cancel-install')} side='left'>
						<button
							className={machineRailButtonClass}
							onClick={cancelInstall}
							aria-label={t('machines.cancel-install')}
						>
							<X className={cn('size-5', machineStopTextClass)} />
						</button>
					</MachinesTooltip>
				</>
			) : machine.state === 'stopped' || machine.state === 'error' ? (
				<MachinesTooltip
					label={
						machine.state === 'error' && machine.installPending
							? t('machines.retry-install')
							: machine.state === 'error'
								? t('machines.start-again')
								: t('machines.start')
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
							machine.state === 'error' && machine.installPending ? t('machines.retry-install') : t('machines.start')
						}
					>
						<Power className='size-5' />
					</button>
				</MachinesTooltip>
			) : (
				<MachinesTooltip label={isBusy ? t(`machines.state.${machine.state}`) : t('machines.stop')} side='left'>
					<button
						className={machineRailButtonClass}
						onClick={() => stop({id: machine.id})}
						disabled={machine.state !== 'running'}
						aria-label={t('machines.stop')}
					>
						{isBusy ? (
							<Loader2 className='size-5 animate-spin' />
						) : (
							<Power className={cn('size-5', machineStopTextClass)} />
						)}
					</button>
				</MachinesTooltip>
			)}
			<MachineMenu machine={machine} buttonClassName={machineRailButtonClass} />
		</motion.div>
	)
}
