import {machineStopBgClass} from '@/features/machines/constants'
import type {MachineState} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

const stateInfo: Record<MachineState, {label: () => string; dotClass: string; pulse?: boolean}> = {
	installing: {label: () => t('machines.state.installing'), dotClass: 'bg-sky-400', pulse: true},
	stopped: {label: () => t('machines.state.stopped'), dotClass: 'bg-white/40'},
	starting: {label: () => t('machines.state.starting'), dotClass: 'bg-amber-400', pulse: true},
	running: {label: () => t('machines.state.running'), dotClass: 'bg-success-light'},
	stopping: {label: () => t('machines.state.stopping'), dotClass: 'bg-amber-400', pulse: true},
	restarting: {label: () => t('machines.state.restarting'), dotClass: 'bg-amber-400', pulse: true},
	error: {label: () => t('machines.state.error'), dotClass: machineStopBgClass},
}

// A state the badge doesn't know renders as a neutral dot instead of crashing
const unknownStateInfo = {label: () => t('unknown'), dotClass: 'bg-white/40'}

export function MachineStateBadge({state, className}: {state: MachineState; className?: string}) {
	const info = stateInfo[state] ?? unknownStateInfo

	return (
		<div
			className={cn(
				'flex h-5 shrink-0 items-center gap-1 rounded-full border-[0.75px] border-white/15 bg-linear-to-b from-white/10 to-white/4 px-[7px]',
				className,
			)}
		>
			<span className={cn('size-[5px] rounded-full', info.dotClass, info.pulse && 'animate-pulse')} />
			<span className='text-[10px] leading-none font-medium -tracking-2 whitespace-nowrap text-white'>
				{info.label()}
			</span>
		</div>
	)
}
