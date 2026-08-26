import {createContext, useContext, useMemo, type ReactNode} from 'react'

import {BACKUPS_PATH, MACHINES_PATH} from '@/features/files/constants'
import {useMachines} from '@/features/machines/hooks/use-machines'
import type {Machine} from '@/features/machines/types'

type MachineFolder = {
	machineId: string | undefined
	machine: Machine | undefined
}

const MachineFoldersContext = createContext<ReadonlyMap<string, Machine>>(new Map())

export function extractMachineIdFromPath(path: string) {
	const parts = path.split('/')
	if (parts.length === 3 && parts[1] === MACHINES_PATH.slice(1) && parts[2]) return parts[2]
	if (parts.length === 5 && parts[1] === BACKUPS_PATH.slice(1) && parts[3] === MACHINES_PATH.slice(1) && parts[4]) {
		return parts[4]
	}
	return undefined
}

export function MachineFoldersProvider({children, enabled}: {children: ReactNode; enabled: boolean}) {
	const {machines} = useMachines({enabled})
	const machinesById = useMemo(() => new Map(machines.map((machine) => [machine.id, machine])), [machines])

	return <MachineFoldersContext.Provider value={machinesById}>{children}</MachineFoldersContext.Provider>
}

// The component boundary lets ordinary paths skip the context subscription
// entirely while preserving the Rules of Hooks for machine paths.
export function MachineFolderMetadata({
	path,
	children,
}: {
	path: string
	children: (metadata: MachineFolder) => ReactNode
}) {
	const machineId = extractMachineIdFromPath(path)
	if (!machineId) return children({machineId: undefined, machine: undefined})
	return <ResolvedMachineFolderMetadata machineId={machineId}>{children}</ResolvedMachineFolderMetadata>
}

function ResolvedMachineFolderMetadata({
	machineId,
	children,
}: {
	machineId: string
	children: (metadata: MachineFolder) => ReactNode
}) {
	const machinesById = useContext(MachineFoldersContext)
	return children({machineId, machine: machinesById.get(machineId)})
}
