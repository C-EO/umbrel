import {OsIcon} from '@/features/machines/components/os-icon'
import type {MachineState} from '@/features/machines/types'
import {cn} from '@/lib/utils'

// App-icon-sized machine icon for surfaces outside the Machines app
// (homescreen, Live Usage). The retro-monitor artwork carries the machine
// identity on its screen, so no extra badge or backdrop is needed.
export function MachineAppIcon({osId, state, className}: {osId: string; state?: MachineState; className?: string}) {
	return (
		<div className={cn('relative aspect-square shrink-0', className)}>
			<OsIcon osId={osId} state={state} className='absolute-center size-full' />
		</div>
	)
}
