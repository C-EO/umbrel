import assert from 'node:assert/strict'
import test from 'node:test'

import type {StorageDevice} from './raid/use-raid-setup.ts'
import {getEligibleStorageDevices, getGenericRaidOnboardingPath, getGenericSsdRaidDevices} from './storage-selection.ts'

function device(overrides: {id?: string; type?: 'hdd' | 'ssd'; isSystemDrive?: boolean}): StorageDevice {
	return {
		id: 'DRIVE_ID',
		type: 'ssd',
		isSystemDrive: false,
		...overrides,
	} as unknown as StorageDevice
}

test('generic onboarding routes HDDs to the HDD RAID flow', () => {
	assert.equal(getGenericRaidOnboardingPath([device({type: 'hdd'})]), '/onboarding/hdd-raid')
})

test('generic onboarding routes SSDs to the SSD RAID flow', () => {
	assert.equal(getGenericRaidOnboardingPath([device({type: 'ssd'})]), '/onboarding/ssd-raid')
})

test('HDD RAID takes priority when both HDDs and SSDs are present', () => {
	assert.equal(
		getGenericRaidOnboardingPath([device({id: 'SSD', type: 'ssd'}), device({id: 'HDD', type: 'hdd'})]),
		'/onboarding/hdd-raid',
	)
})

test('system drives and devices without stable ids do not trigger RAID onboarding', () => {
	const devices = [device({id: 'BOOT', type: 'ssd', isSystemDrive: true}), device({id: undefined, type: 'hdd'})]

	assert.deepEqual(getEligibleStorageDevices(devices), [])
	assert.equal(getGenericRaidOnboardingPath(devices), null)
})

test('system HDDs do not hide an eligible SSD RAID option', () => {
	assert.equal(
		getGenericRaidOnboardingPath([
			device({id: 'BOOT', type: 'hdd', isSystemDrive: true}),
			device({id: 'DATA', type: 'ssd'}),
		]),
		'/onboarding/ssd-raid',
	)
})

test('generic SSD RAID receives only eligible non-system SSDs', () => {
	const devices = [
		device({id: 'DATA_SSD', type: 'ssd'}),
		device({id: 'BOOT_SSD', type: 'ssd', isSystemDrive: true}),
		device({id: 'DATA_HDD', type: 'hdd'}),
		device({id: undefined, type: 'ssd'}),
	]

	assert.deepEqual(
		getGenericSsdRaidDevices(devices).map((candidate) => candidate.id),
		['DATA_SSD'],
	)
})

test('generic SSD RAID preserves every eligible SSD without a four-drive cap', () => {
	const devices = Array.from({length: 6}, (_, index) => device({id: `DATA_SSD_${index + 1}`, type: 'ssd'}))

	assert.deepEqual(
		getGenericSsdRaidDevices(devices).map((candidate) => candidate.id),
		['DATA_SSD_1', 'DATA_SSD_2', 'DATA_SSD_3', 'DATA_SSD_4', 'DATA_SSD_5', 'DATA_SSD_6'],
	)
})
