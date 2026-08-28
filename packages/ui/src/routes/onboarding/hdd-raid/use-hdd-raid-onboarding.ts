import type {StorageDevice} from '../raid/use-raid-setup'

// Config handed from the pre-reboot setup steps to /onboarding/hdd-raid/setup via
// location.state.
export type HddRaidSetupConfig = {
	raidDevices: string[]
	raidType: 'storage' | 'failsafe'
	acceleratorDevices?: string[]
}

// Split eligible (non-system, identifiable) devices into data-drive and accelerator
// candidates. The backend forbids mixing SSDs and HDDs in one array, so HDDs are the
// data drives and SSDs can only accelerate.
export function getCandidates(devices: StorageDevice[]) {
	const eligible = devices.filter((device) => !device.isSystemDrive && device.id)
	return {
		hdds: eligible.filter((device) => device.type === 'hdd'),
		ssds: eligible.filter((device) => device.type === 'ssd'),
	}
}

// Deterministic ordering: largest first, ties broken by id
function bySizeThenId(a: StorageDevice, b: StorageDevice) {
	return b.roundedSize - a.roundedSize || (a.id ?? '').localeCompare(b.id ?? '')
}

// Auto-pair HDDs for FailSafe mirrors: drives of equal rounded size are paired largest
// first, the rest stay unpaired (they're left out of the pool and can be paired later
// from the storage manager).
export function planFailsafePairs(hdds: StorageDevice[]) {
	const sorted = [...hdds].sort(bySizeThenId)
	const pairs: [StorageDevice, StorageDevice][] = []
	const unpaired: StorageDevice[] = []
	let i = 0
	while (i < sorted.length) {
		if (i + 1 < sorted.length && sorted[i].roundedSize === sorted[i + 1].roundedSize) {
			pairs.push([sorted[i], sorted[i + 1]])
			i += 2
		} else {
			unpaired.push(sorted[i])
			i += 1
		}
	}
	return {pairs, unpaired}
}

// Pick the accelerator pair for FailSafe mode: the two largest SSDs sharing a rounded
// size (the accelerator is mirrored, so the SSDs must match).
export function planAcceleratorPair(ssds: StorageDevice[]): [StorageDevice, StorageDevice] | null {
	const sorted = [...ssds].sort(bySizeThenId)
	for (let i = 0; i + 1 < sorted.length; i++) {
		if (sorted[i].roundedSize === sorted[i + 1].roundedSize) return [sorted[i], sorted[i + 1]]
	}
	return null
}
