import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {CmdkSearchProviderProps} from '@/components/cmdk-providers'
import {CommandItem} from '@/components/ui/command'
import {OsIcon} from '@/features/machines/components/os-icon'
import {machinePath} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {trpcReact} from '@/trpc/trpc'

// Per-machine command-k entries with live state: open every machine, plus a
// start/stop action depending on the machine's current state. Matching happens
// through each item's `value` (machine name + the word "machines" + the action),
// so typing a machine name or "machines" surfaces the relevant rows.
export const MachinesCmdkSearchProvider: React.FC<CmdkSearchProviderProps> = ({query, close}) => {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'
	const {machines} = useMachines({enabled: isOwner})
	const {start, stop} = useMachineActions()

	const trimmedQuery = query.trim()
	if (!isOwner || trimmedQuery.length === 0) return null

	return machines.flatMap((machine) => {
		const items = [
			<CommandItem
				key={`${machine.id}-open`}
				icon={<OsIcon osId={machine.osId} state={machine.state} className='h-full w-full' />}
				value={`${t('machines.open')} ${machine.name} machines`}
				onSelect={() => {
					navigate(machinePath(machine.id))
					close()
				}}
			>
				<span>
					{t('machines.open')} {machine.name} <span className='opacity-50'>{t('generic-in')} Machines</span>
				</span>
			</CommandItem>,
		]

		if (machine.state === 'stopped' || machine.state === 'error') {
			items.push(
				<CommandItem
					key={`${machine.id}-start`}
					icon={<OsIcon osId={machine.osId} state={machine.state} className='h-full w-full' />}
					value={`${t('machines.start')} ${machine.name} machines`}
					onSelect={() => {
						start({id: machine.id})
						close()
					}}
				>
					<span>
						{t('machines.start')} {machine.name} <span className='opacity-50'>{t('generic-in')} Machines</span>
					</span>
				</CommandItem>,
			)
		} else if (machine.state === 'running') {
			items.push(
				<CommandItem
					key={`${machine.id}-stop`}
					icon={<OsIcon osId={machine.osId} state={machine.state} className='h-full w-full' />}
					value={`${t('machines.stop')} ${machine.name} machines`}
					onSelect={() => {
						stop({id: machine.id})
						close()
					}}
				>
					<span>
						{t('machines.stop')} {machine.name} <span className='opacity-50'>{t('generic-in')} Machines</span>
					</span>
				</CommandItem>,
			)
		}

		return items
	})
}
