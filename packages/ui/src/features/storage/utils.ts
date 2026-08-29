import prettyBytes from 'pretty-bytes'

import type {RaidDevice, RaidStatus, StorageDevice} from './hooks/use-storage'

type RaidErrorCounters = Pick<RaidDevice, 'readErrors' | 'writeErrors' | 'checksumErrors'>

export function hasRaidErrors(device?: RaidErrorCounters): boolean {
	return !!device && (device.readErrors > 0 || device.writeErrors > 0 || device.checksumErrors > 0)
}

export function getPoolDeviceType(
	raidStatus: RaidStatus | undefined,
	allDevices: StorageDevice[],
): 'ssd' | 'hdd' | undefined {
	if (!raidStatus?.exists) return undefined

	const poolDeviceIds = new Set(raidStatus.devices?.map((device) => device.id) ?? [])
	const attachedPoolDevice = allDevices.find((device) => device.id && poolDeviceIds.has(device.id))
	if (attachedPoolDevice) return attachedPoolDevice.type

	// Mirror data vdevs and accelerators identify HDD pools even when their physical
	// members are detached. Without either hint, retain the existing SSD fallback.
	if (raidStatus.topology === 'mirror' || raidStatus.accelerator?.exists) return 'hdd'
	return 'ssd'
}

// Format bytes without space, rounding to integer only for 3+ digit values (>=100) to avoid overflow
// e.g., "4.5TB", "45.2GB", "256GB" - only 256.1GB gets rounded because 256 >= 100
export const formatStorageSize = (bytes: number) => {
	// First format with 1 decimal to determine the numeric value
	const formatted = prettyBytes(bytes, {maximumFractionDigits: 1})
	const numericValue = parseFloat(formatted)

	// If 3+ digits (>=100), round to integer to keep string short
	const fractionDigits = numericValue >= 100 ? 0 : 1

	return prettyBytes(bytes, {maximumFractionDigits: fractionDigits}).replace(' ', '')
}

// Pair up unpooled drives for adding to a mirror FailSafe array.
// Greedy largest-with-next-largest pairing always forms pairs when two or more drives are
// attached, even with mismatched sizes (ZFS clamps a mirror to its smaller member). A single
// leftover drive stays unpaired until a partner is attached.
export function planMirrorAdditions(unpooledDrives: StorageDevice[]): {
	pairs: [StorageDevice, StorageDevice][]
	unpaired: StorageDevice[]
} {
	const sorted = [...unpooledDrives].sort((a, b) => b.roundedSize - a.roundedSize)
	const pairs: [StorageDevice, StorageDevice][] = []
	for (; sorted.length >= 2; sorted.splice(0, 2)) pairs.push([sorted[0], sorted[1]])
	return {pairs, unpaired: sorted}
}

// A pool drive matched with the unpooled drive that would mirror it during the
// storage -> failsafe transition. `newDevice` is undefined when no attached drive is
// large enough, in which case the UI asks for a drive of at least `requiredSize`.
export type FailsafeTransitionPairPlan = {
	existingDevice: RaidDevice
	newDevice?: StorageDevice
	requiredSize: number
}

export type FailsafeTransitionPlan = {
	pairs: FailsafeTransitionPairPlan[]
	// Only set when the pool has an accelerator: the SSD that will mirror it (or undefined + required size when missing)
	acceleratorNewDevice?: StorageDevice
	acceleratorRequiredSize?: number
	// True when every pool drive (and the accelerator, if any) has a matched new device
	satisfied: boolean
}

// Plan the storage -> failsafe transition: every pool drive needs a new drive of at least its
// rounded size (backend validates the same rule), and an existing accelerator needs one more SSD.
// Pool drives are matched largest-first, each taking the smallest candidate that fits, which
// minimizes clamped-away space.
export function planFailsafeTransition({
	poolDrives,
	unpooledDrives,
	unpooledSsds,
	acceleratorDevice,
}: {
	poolDrives: RaidDevice[]
	unpooledDrives: StorageDevice[]
	unpooledSsds: StorageDevice[]
	// Physical device backing the existing accelerator, when the pool has one
	acceleratorDevice?: StorageDevice
}): FailsafeTransitionPlan {
	const candidates = [...unpooledDrives].sort((a, b) => a.roundedSize - b.roundedSize)

	const pairs = [...poolDrives]
		.sort((a, b) => b.roundedSize - a.roundedSize)
		.map((existingDevice): FailsafeTransitionPairPlan => {
			const index = candidates.findIndex((candidate) => candidate.roundedSize >= existingDevice.roundedSize)
			const newDevice = index === -1 ? undefined : candidates.splice(index, 1)[0]
			return {existingDevice, newDevice, requiredSize: existingDevice.roundedSize}
		})

	let acceleratorNewDevice: StorageDevice | undefined
	let acceleratorRequiredSize: number | undefined
	if (acceleratorDevice) {
		acceleratorRequiredSize = acceleratorDevice.roundedSize
		acceleratorNewDevice = [...unpooledSsds]
			.sort((a, b) => a.roundedSize - b.roundedSize)
			.find((candidate) => candidate.roundedSize >= acceleratorDevice.roundedSize)
	}

	const satisfied =
		pairs.every((pair) => pair.newDevice !== undefined) && (!acceleratorDevice || acceleratorNewDevice !== undefined)

	return {pairs, acceleratorNewDevice, acceleratorRequiredSize, satisfied}
}

// Standard SSD capacities in GB. The accelerator guidance is ~32x the device's RAM,
// mapped to the smallest standard drive that satisfies it and capped at 4TB:
// 4GB RAM -> 128GB, 8GB -> 256GB ... 128GB+ -> 4TB.
const ssdSizeBucketsGb = [128, 256, 512, 1024, 2048, 4096]
export function recommendedSsdSizeLabel(ramBytes: number) {
	const nominalRamGb = Math.max(1, Math.round(ramBytes / 2 ** 30))
	const sizeGb = ssdSizeBucketsGb.find((bucket) => bucket >= nominalRamGb * 32) ?? ssdSizeBucketsGb.at(-1)!
	return sizeGb >= 1024 ? `${sizeGb / 1024}TB` : `${sizeGb}GB`
}
