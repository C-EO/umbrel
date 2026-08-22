import {useNavigate} from 'react-router-dom'

import {CmdkSearchProviderProps} from '@/components/cmdk-providers'
import {CommandItem} from '@/components/ui/command'
import {OsIcon} from '@/features/machines/components/os-icon'
import {machinePath} from '@/features/machines/constants'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {trpcReact} from '@/trpc/trpc'

// One command-k entry per machine: its name, opening its machine view.
// Matching happens through each item's `value` (machine name + the word
// "machines"), so typing a machine name or "machines" surfaces the rows.
export const MachinesCmdkSearchProvider: React.FC<CmdkSearchProviderProps> = ({query, close}) => {
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'
	const {machines} = useMachines({enabled: isOwner})

	const trimmedQuery = query.trim()
	if (!isOwner || trimmedQuery.length === 0) return null

	return machines.map((machine) => (
		<CommandItem
			key={machine.id}
			icon={<OsIcon osId={machine.osId} state={machine.state} className='h-full w-full' />}
			value={`${machine.name} machines`}
			onSelect={() => {
				navigate(machinePath(machine.id))
				close()
			}}
		>
			{machine.name}
		</CommandItem>
	))
}
