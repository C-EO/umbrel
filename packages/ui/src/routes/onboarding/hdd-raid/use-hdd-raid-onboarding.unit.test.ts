import assert from 'node:assert/strict'
import test from 'node:test'

import type {StorageDevice} from '../raid/use-raid-setup.ts'
import {getCandidates, planAcceleratorPair, planFailsafePairs} from './use-hdd-raid-onboarding.ts'

const TB = 1_000_000_000_000

function device(overrides: {
	id?: string
	type?: 'hdd' | 'ssd'
	roundedSize?: number
	isSystemDrive?: boolean
}): StorageDevice {
	return {
		id: 'MODEL_SERIAL',
		type: 'hdd',
		roundedSize: 6 * TB,
		size: 6 * TB,
		isSystemDrive: false,
		...overrides,
	} as unknown as StorageDevice
}

const ids = (devices: StorageDevice[]) => devices.map((d) => d.id)

test('getCandidates excludes system drives and devices without an id', () => {
	const {hdds, ssds} = getCandidates([
		device({id: 'HDD_A'}),
		device({id: 'SSD_A', type: 'ssd'}),
		device({id: 'BOOT_DRIVE', type: 'ssd', isSystemDrive: true}),
		device({id: undefined}),
	])
	assert.deepEqual(ids(hdds), ['HDD_A'])
	assert.deepEqual(ids(ssds), ['SSD_A'])
})

test('planFailsafePairs pairs drives of equal rounded size, keeping same-model drives together', () => {
	// Ties within a size class are broken by id, and umbrel ids start with the model -
	// so same-model drives sort adjacent and pair with each other
	const {pairs, unpaired} = planFailsafePairs([
		device({id: 'WDC_WD60_SERIAL1'}),
		device({id: 'ST6000_SERIAL1'}),
		device({id: 'WDC_WD60_SERIAL2'}),
		device({id: 'ST6000_SERIAL2'}),
	])
	assert.deepEqual(
		pairs.map((pair) => ids(pair)),
		[
			['ST6000_SERIAL1', 'ST6000_SERIAL2'],
			['WDC_WD60_SERIAL1', 'WDC_WD60_SERIAL2'],
		],
	)
	assert.deepEqual(unpaired, [])
})

test('planFailsafePairs orders pairs largest first', () => {
	const {pairs, unpaired} = planFailsafePairs([
		device({id: 'SMALL_A', roundedSize: 4 * TB}),
		device({id: 'BIG_A', roundedSize: 8 * TB}),
		device({id: 'SMALL_B', roundedSize: 4 * TB}),
		device({id: 'BIG_B', roundedSize: 8 * TB}),
	])
	assert.deepEqual(
		pairs.map((pair) => ids(pair)),
		[
			['BIG_A', 'BIG_B'],
			['SMALL_A', 'SMALL_B'],
		],
	)
	assert.deepEqual(unpaired, [])
})

test('planFailsafePairs never pairs drives of different rounded sizes', () => {
	const {pairs, unpaired} = planFailsafePairs([
		device({id: 'BIG', roundedSize: 6 * TB}),
		device({id: 'SMALL', roundedSize: 4 * TB}),
	])
	assert.deepEqual(pairs, [])
	assert.deepEqual(ids(unpaired), ['BIG', 'SMALL'])
})

test('planFailsafePairs leaves the odd drive out of a size class unpaired', () => {
	const {pairs, unpaired} = planFailsafePairs([
		device({id: 'A', roundedSize: 6 * TB}),
		device({id: 'B', roundedSize: 6 * TB}),
		device({id: 'C', roundedSize: 4 * TB}),
	])
	assert.deepEqual(
		pairs.map((pair) => ids(pair)),
		[['A', 'B']],
	)
	assert.deepEqual(ids(unpaired), ['C'])
})

test('planFailsafePairs handles empty and single-drive inputs', () => {
	assert.deepEqual(planFailsafePairs([]), {pairs: [], unpaired: []})
	const single = planFailsafePairs([device({id: 'ONLY'})])
	assert.deepEqual(single.pairs, [])
	assert.deepEqual(ids(single.unpaired), ['ONLY'])
})

test('planAcceleratorPair picks the largest same-size SSD pair', () => {
	const pair = planAcceleratorPair([
		device({id: 'SMALL_A', type: 'ssd', roundedSize: 1 * TB}),
		device({id: 'BIG_A', type: 'ssd', roundedSize: 2 * TB}),
		device({id: 'SMALL_B', type: 'ssd', roundedSize: 1 * TB}),
		device({id: 'BIG_B', type: 'ssd', roundedSize: 2 * TB}),
	])
	assert.deepEqual(ids(pair ?? []), ['BIG_A', 'BIG_B'])
})

test('planAcceleratorPair returns null without a matching pair', () => {
	assert.equal(planAcceleratorPair([]), null)
	assert.equal(planAcceleratorPair([device({id: 'ONLY', type: 'ssd'})]), null)
	assert.equal(
		planAcceleratorPair([
			device({id: 'BIG', type: 'ssd', roundedSize: 2 * TB}),
			device({id: 'SMALL', type: 'ssd', roundedSize: 1 * TB}),
		]),
		null,
	)
})

test('planAcceleratorPair is deterministic for more than two matching SSDs', () => {
	const pair = planAcceleratorPair([
		device({id: 'SSD_C', type: 'ssd'}),
		device({id: 'SSD_A', type: 'ssd'}),
		device({id: 'SSD_B', type: 'ssd'}),
	])
	assert.deepEqual(ids(pair ?? []), ['SSD_A', 'SSD_B'])
})
