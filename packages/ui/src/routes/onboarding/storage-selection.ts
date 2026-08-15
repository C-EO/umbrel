import type {StorageDevice} from './raid/use-raid-setup'

export type GenericRaidOnboardingPath = '/onboarding/hdd-raid' | '/onboarding/ssd-raid'

// Generic machines may report the boot disk alongside data disks. Only identifiable,
// non-system drives can participate in onboarding RAID setup.
export function getEligibleStorageDevices(devices: StorageDevice[]) {
	return devices.filter((device) => !device.isSystemDrive && device.id)
}

export function getGenericSsdRaidDevices(devices: StorageDevice[]) {
	return getEligibleStorageDevices(devices).filter((device) => device.type === 'ssd')
}

// HDD arrays take priority when a generic machine has both drive types: SSDs can be
// offered as HDD accelerators by that flow. SSD-only machines use the SSD RAID flow.
export function getGenericRaidOnboardingPath(devices: StorageDevice[]): GenericRaidOnboardingPath | null {
	const eligibleDevices = getEligibleStorageDevices(devices)

	if (eligibleDevices.some((device) => device.type === 'hdd')) return '/onboarding/hdd-raid'
	if (eligibleDevices.some((device) => device.type === 'ssd')) return '/onboarding/ssd-raid'

	return null
}
