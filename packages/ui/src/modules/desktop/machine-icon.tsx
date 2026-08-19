import {motion} from 'motion/react'
import {useNavigate} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {MachineAppIcon} from '@/features/machines/components/machine-app-icon'
import {machinePath} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import type {Machine} from '@/features/machines/types'
import {t} from '@/utils/i18n'

// Desktop icon for a machine pinned to the homescreen. Looks like an app icon
// with a small Machines-app thumbnail in the corner marking its origin app
// (see Figma "Pinning VMs to Homepage").
export function MachineIcon({machine}: {machine: Machine}) {
	const navigate = useNavigate()
	const {start, stop, forceStop, setPinned} = useMachineActions()

	return (
		<ContextMenu>
			<ContextMenuTrigger className='group'>
				<motion.button
					onClick={() => navigate(machinePath(machine.id))}
					className='group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3 focus:outline-hidden'
					layout
					initial={{opacity: 1, scale: 0.8}}
					animate={{opacity: 1, scale: 1}}
					exit={{opacity: 0, scale: 0.5}}
					transition={{type: 'spring', stiffness: 500, damping: 30}}
				>
					<MachineAppIcon
						osId={machine.osId}
						state={machine.state}
						className='w-12 rounded-10 ring-white/25 transition-all duration-300 group-hover:scale-110 group-hover:ring-6 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6 md:w-16 md:rounded-15'
					/>
					<div className='max-w-full text-11 leading-normal drop-shadow-desktop-label md:text-13'>
						<div className='truncate contrast-more:bg-black contrast-more:px-1'>{machine.name}</div>
					</div>
				</motion.button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => navigate(machinePath(machine.id))}>{t('machines.open')}</ContextMenuItem>
				{machine.state === 'stopped' || machine.state === 'error' ? (
					<ContextMenuItem onSelect={() => start({id: machine.id})}>
						{machine.state === 'error' ? t('machines.start-again') : t('machines.start')}
					</ContextMenuItem>
				) : (
					<ContextMenuItem disabled={machine.state !== 'running'} onSelect={() => stop({id: machine.id})}>
						{t('machines.stop')}
					</ContextMenuItem>
				)}
				{machine.state !== 'stopped' && machine.state !== 'installing' && (
					<ContextMenuItem
						className={contextMenuClasses.item.rootDestructive}
						onSelect={() => forceStop({id: machine.id})}
					>
						{t('machines.force-stop')}
					</ContextMenuItem>
				)}
				<ContextMenuItem
					className={contextMenuClasses.item.rootDestructive}
					onSelect={() => setPinned({id: machine.id, pinned: false})}
				>
					{t('machines.unpin-from-homescreen')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
