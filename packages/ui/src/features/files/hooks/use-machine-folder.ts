import {BACKUPS_PATH, MACHINES_PATH} from '@/features/files/constants'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {trpcReact} from '@/trpc/trpc'

export function extractMachineIdFromPath(path: string) {
	const parts = path.split('/')
	if (parts.length === 3 && parts[1] === MACHINES_PATH.slice(1) && parts[2]) return parts[2]
	if (parts.length === 5 && parts[1] === BACKUPS_PATH.slice(1) && parts[3] === MACHINES_PATH.slice(1) && parts[4]) {
		return parts[4]
	}
	return undefined
}

export function useMachineFolder(path: string) {
	const userQ = trpcReact.user.get.useQuery()
	const {machines} = useMachines({enabled: userQ.data?.role === 'owner'})
	const machineId = extractMachineIdFromPath(path)
	return {
		machineId,
		machine: machineId ? machines.find((machine) => machine.id === machineId) : undefined,
	}
}
