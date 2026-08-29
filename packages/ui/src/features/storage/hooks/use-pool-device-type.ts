import {trpcReact} from '@/trpc/trpc'

import {getPoolDeviceType} from '../utils'

// Classifies the active pool for visuals that live outside the storage manager (the
// floating island). Pool composition can't change mid-operation, so the queries are
// given a generous staleTime; both are shared with the storage manager and settings,
// so react-query usually serves them from cache. Falls back to 'ssd' while loading or
// when queries fail (e.g. mid-reboot), matching the pre-split visual.
export function usePoolDeviceType(): 'ssd' | 'hdd' {
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {staleTime: 60_000})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {staleTime: 60_000})
	return getPoolDeviceType(raidStatusQ.data, devicesQ.data ?? []) ?? 'ssd'
}
