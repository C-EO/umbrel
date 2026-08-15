import {Loader2, Power} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {TbAlertTriangleFilled} from 'react-icons/tb'

import {MachineConsole} from '@/features/machines/components/machine-console'
import {OsIcon} from '@/features/machines/components/os-icon'
import {machineStopTextClass} from '@/features/machines/constants'
import {getMachinesErrorMessage, useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

// Shared "start" affordance on the stopped/error screens
const screenActionButtonClass =
	'flex h-[30px] items-center rounded-full border-hpx border-white/20 bg-white/10 px-4 text-13 font-medium text-white transition-[background-color,transform] duration-200 hover:bg-white/15 active:scale-95'

// The VM "screen": renders whatever the machine would be showing for its
// current state, crossfading between states. Fills its (relatively
// positioned) parent.
export function MachineDisplay({machine}: {machine: Machine}) {
	const consoleVisible = ['starting', 'running', 'restarting', 'stopping'].includes(machine.state)
	return (
		<AnimatePresence initial={false}>
			<motion.div
				// Keyed by machine too: switching between VMs crossfades the
				// screens in place instead of hard-swapping content
				// Keep the console mounted across restart lifecycle states. Remounting
				// briefly opened overlapping sessions during the crossfade, causing this
				// tab to supersede itself and show the multi-tab takeover overlay.
				key={`${machine.id}:${consoleVisible ? 'console' : machine.state}`}
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				exit={{opacity: 0}}
				transition={{duration: 0.4, ease: 'easeOut'}}
				className='absolute inset-0'
			>
				<Screen machine={machine} />
			</motion.div>
		</AnimatePresence>
	)
}

function Screen({machine}: {machine: Machine}) {
	switch (machine.state) {
		case 'installing':
			return <InstallingScreen machine={machine} />
		case 'starting':
		case 'restarting':
		case 'running':
		case 'stopping':
			return <ConsoleScreen machine={machine} />
		case 'error':
			return <ErrorScreen machine={machine} />
		case 'stopped':
			return <StoppedScreen machine={machine} />
	}
}

function ConsoleScreen({machine}: {machine: Machine}) {
	return (
		<>
			<MachineConsole machineId={machine.id} />
			{machine.state === 'running' && machine.firstBootSetup && (
				<div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center backdrop-blur-sm'>
					<Loader2 className='size-6 animate-spin text-white/70' />
					<span className='text-13 text-white/70'>{t('machines.completing-setup', {os: machine.osName})}</span>
				</div>
			)}
			{machine.state === 'stopping' && (
				<div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm'>
					<Loader2 className='size-6 animate-spin text-white/70' />
					<span className='text-13 text-white/70'>{t('machines.shutting-down')}</span>
				</div>
			)}
		</>
	)
}

function InstallingScreen({machine}: {machine: Machine}) {
	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black md:gap-5'>
			<OsIcon osId={machine.osId} className='size-12 md:size-16' />
			<div className='flex flex-col items-center gap-3'>
				<Loader2 className='size-5 animate-spin text-white/50' />
				<span className='text-13 -tracking-2 text-white/50'>{t('machines.installing-os', {os: machine.osName})}</span>
			</div>
		</div>
	)
}

function StoppedScreen({machine}: {machine: Machine}) {
	const {start} = useMachineActions()

	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black'>
			<Power className='size-8 text-white/25' />
			<span className='text-13 -tracking-2 text-white/40'>{t('machines.machine-off')}</span>
			<button onClick={() => start({id: machine.id})} className={screenActionButtonClass}>
				{t('machines.start')}
			</button>
		</div>
	)
}

// A machine that failed to install/boot: shows the failure message and a
// one-click recovery (the backend allows start from 'error'). The force-stop
// escape hatch lives in the rail/menu.
function ErrorScreen({machine}: {machine: Machine}) {
	const {start, retryInstall} = useMachineActions()
	const retryingInstall = machine.installPending

	return (
		<div className='absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center'>
			<TbAlertTriangleFilled className={cn('size-8', machineStopTextClass)} />
			<div className='flex flex-col gap-1.5'>
				<span className='text-15 font-medium -tracking-2 text-white'>{t('machines.error-title')}</span>
				{machine.errorMessage && (
					<span className='max-w-sm text-13 -tracking-2 text-white/50'>
						{getMachinesErrorMessage(machine.errorMessage)}
					</span>
				)}
			</div>
			<button
				onClick={() => (retryingInstall ? retryInstall({id: machine.id}) : start({id: machine.id}))}
				className={screenActionButtonClass}
			>
				{retryingInstall ? t('machines.retry-install') : t('machines.start-again')}
			</button>
		</div>
	)
}
