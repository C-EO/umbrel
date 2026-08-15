import type {Machine, OsImage} from '@/features/machines/types'
import {trpcReact} from '@/trpc/trpc'

// Live-updates the machines and OS image query caches from event bus snapshots.
// Mount once per surface that needs live data (MachinesLayout, fullscreen console).
export function useMachinesLiveUpdates() {
	const utils = trpcReact.useUtils()

	trpcReact.eventBus.listen.useSubscription(
		{event: 'machines:updated'},
		{
			// Refetch on every (re)connect so a dropped websocket can't leave the
			// progress UI frozen on a stale snapshot (onStarted fires on reconnect too)
			onStarted: () => utils.machines.list.invalidate(),
			onData: (data) => utils.machines.list.setData(undefined, data as Machine[]),
			onError: (error) => console.error('machines:updated subscription error', error),
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'machines:os-images-updated'},
		{
			onStarted: () => utils.machines.osImages.invalidate(),
			onData: (data) => utils.machines.osImages.setData(undefined, data as OsImage[]),
			onError: (error) => console.error('machines:os-images-updated subscription error', error),
		},
	)
}

export function useMachines({enabled = true}: {enabled?: boolean} = {}) {
	const machinesQ = trpcReact.machines.list.useQuery(undefined, {
		enabled,
		staleTime: 5_000,
		retry: false,
	})

	return {
		machines: machinesQ.data ?? [],
		isLoading: machinesQ.isLoading,
		isError: machinesQ.isError,
		refetch: machinesQ.refetch,
	}
}

export function useMachine(machineId?: string) {
	const {machines, isLoading} = useMachines()

	return {
		machine: machineId ? machines.find((machine) => machine.id === machineId) : undefined,
		isLoading,
	}
}

export function useOsImages() {
	const osImagesQ = trpcReact.machines.osImages.useQuery(undefined, {
		staleTime: 5_000,
		retry: false,
	})

	return {
		osImages: osImagesQ.data ?? [],
		isLoading: osImagesQ.isLoading,
		isError: osImagesQ.isError,
		refetch: osImagesQ.refetch,
	}
}

export function useMachineCapabilities() {
	const query = trpcReact.machines.capabilities.useQuery(undefined, {staleTime: Infinity, retry: false})
	return {capabilities: query.data, isLoading: query.isLoading}
}
