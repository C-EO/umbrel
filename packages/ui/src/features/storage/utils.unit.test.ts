import assert from 'node:assert/strict'
import test from 'node:test'

import type {RaidDevice, RaidStatus, StorageDevice} from './hooks/use-storage.ts'
import {
	canDisconnectPoolMember,
	getPoolDeviceType,
	hasRaidErrors,
	planFailsafeTransition,
	planMirrorAdditions,
} from './utils.ts'

const TB = 1_000_000_000_000

function device(overrides: {id?: string; type?: 'hdd' | 'ssd'; roundedSize?: number}): StorageDevice {
	return {
		id: 'MODEL_SERIAL',
		type: 'hdd',
		roundedSize: 6 * TB,
		size: 6 * TB,
		isSystemDrive: false,
		...overrides,
	} as unknown as StorageDevice
}

function poolDrive(overrides: {id?: string; roundedSize?: number}): RaidDevice {
	return {
		id: 'POOL_MODEL_SERIAL',
		roundedSize: 6 * TB,
		status: 'ONLINE',
		...overrides,
	} as unknown as RaidDevice
}

const ids = (devices: Array<{id?: string}>) => devices.map((d) => d.id)

test('hasRaidErrors detects every non-zero ZFS device error counter', () => {
	assert.equal(hasRaidErrors(undefined), false)
	assert.equal(hasRaidErrors({readErrors: 0, writeErrors: 0, checksumErrors: 0}), false)
	assert.equal(hasRaidErrors({readErrors: 1, writeErrors: 0, checksumErrors: 0}), true)
	assert.equal(hasRaidErrors({readErrors: 0, writeErrors: 1, checksumErrors: 0}), true)
	assert.equal(hasRaidErrors({readErrors: 0, writeErrors: 0, checksumErrors: 1}), true)
})

test('getPoolDeviceType routes attached SSD and HDD pools to their matching manager', () => {
	const pool = {
		exists: true,
		devices: [{id: 'POOL', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
	} as RaidStatus

	assert.equal(getPoolDeviceType(pool, [device({id: 'POOL', type: 'ssd'})]), 'ssd')
	assert.equal(getPoolDeviceType(pool, [device({id: 'POOL', type: 'hdd'})]), 'hdd')
})

test('getPoolDeviceType uses topology hints when pool members are detached', () => {
	const detachedPool = {
		exists: true,
		devices: [{id: 'MISSING', status: 'UNAVAIL', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
	} as RaidStatus

	assert.equal(getPoolDeviceType({...detachedPool, topology: 'mirror'}, []), 'hdd')
	assert.equal(getPoolDeviceType({...detachedPool, topology: 'raidz'}, []), 'ssd')
	assert.equal(getPoolDeviceType({name: 'umbrel', exists: false}, []), undefined)
})

test('planMirrorAdditions pairs largest drives first, allowing mismatched sizes', () => {
	// Unlike the onboarding pairing, mirror additions accept unequal pairs - ZFS clamps
	// the mirror to its smaller member and the dialog explains the clamped capacity
	const {pairs, unpaired} = planMirrorAdditions([
		device({id: 'SMALL', roundedSize: 4 * TB}),
		device({id: 'BIG_A', roundedSize: 8 * TB}),
		device({id: 'BIG_B', roundedSize: 8 * TB}),
	])
	assert.deepEqual(
		pairs.map((pair) => ids(pair)),
		[['BIG_A', 'BIG_B']],
	)
	assert.deepEqual(ids(unpaired), ['SMALL'])

	const mismatched = planMirrorAdditions([
		device({id: 'BIG', roundedSize: 8 * TB}),
		device({id: 'SMALL', roundedSize: 4 * TB}),
	])
	assert.deepEqual(
		mismatched.pairs.map((pair) => ids(pair)),
		[['BIG', 'SMALL']],
	)
	assert.deepEqual(mismatched.unpaired, [])
})

test('planFailsafeTransition matches each pool drive with the smallest fitting candidate', () => {
	const plan = planFailsafeTransition({
		poolDrives: [poolDrive({id: 'POOL_BIG', roundedSize: 6 * TB}), poolDrive({id: 'POOL_SMALL', roundedSize: 4 * TB})],
		unpooledDrives: [
			device({id: 'SPARE_4', roundedSize: 4 * TB}),
			device({id: 'SPARE_8', roundedSize: 8 * TB}),
			device({id: 'SPARE_6', roundedSize: 6 * TB}),
		],
		unpooledSsds: [],
	})
	// Largest pool drive first, each taking the smallest candidate that fits - the 8TB
	// spare stays unused instead of being clamped
	assert.deepEqual(
		plan.pairs.map((pair) => [pair.existingDevice.id, pair.newDevice?.id]),
		[
			['POOL_BIG', 'SPARE_6'],
			['POOL_SMALL', 'SPARE_4'],
		],
	)
	assert.equal(plan.satisfied, true)
})

test('planFailsafeTransition reports unsatisfied pool drives with their required size', () => {
	const plan = planFailsafeTransition({
		poolDrives: [poolDrive({id: 'POOL', roundedSize: 6 * TB})],
		unpooledDrives: [device({id: 'TOO_SMALL', roundedSize: 4 * TB})],
		unpooledSsds: [],
	})
	assert.equal(plan.pairs[0].newDevice, undefined)
	assert.equal(plan.pairs[0].requiredSize, 6 * TB)
	assert.equal(plan.satisfied, false)
})

test('planFailsafeTransition requires a fitting SSD when the pool has an accelerator', () => {
	const base = {
		poolDrives: [poolDrive({id: 'POOL', roundedSize: 6 * TB})],
		unpooledDrives: [device({id: 'SPARE', roundedSize: 6 * TB})],
		acceleratorDevice: device({id: 'ACCEL', type: 'ssd', roundedSize: 1 * TB}),
	}

	const satisfied = planFailsafeTransition({
		...base,
		unpooledSsds: [
			device({id: 'SSD_BIG', type: 'ssd', roundedSize: 2 * TB}),
			device({id: 'SSD_FIT', type: 'ssd', roundedSize: 1 * TB}),
		],
	})
	// Smallest fitting SSD wins, larger one stays free
	assert.equal(satisfied.acceleratorNewDevice?.id, 'SSD_FIT')
	assert.equal(satisfied.acceleratorRequiredSize, 1 * TB)
	assert.equal(satisfied.satisfied, true)

	const missingSsd = planFailsafeTransition({...base, unpooledSsds: []})
	assert.equal(missingSsd.acceleratorNewDevice, undefined)
	assert.equal(missingSsd.satisfied, false)
})

function removalPool(overrides: Partial<RaidStatus> = {}): RaidStatus {
	return {
		name: 'umbrelos-test',
		exists: true,
		raidType: 'failsafe',
		status: 'ONLINE',
		topology: 'mirror',
		mirrors: [['A', 'B']],
		devices: ['A', 'B'].map((id) => ({id, status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0})),
		...overrides,
	}
}

test('physical swap never removes the surviving member of a degraded mirror', () => {
	const pool = removalPool({status: 'DEGRADED'})
	pool.devices![0].status = 'UNAVAIL'
	assert.equal(canDisconnectPoolMember(pool, 'B', [device({id: 'B'})]), false)
	assert.equal(canDisconnectPoolMember(pool, 'A', [device({id: 'B'})]), true)
})

test('physical swap requires known topology, member identity, and surviving physical inventory', () => {
	const pool = removalPool()
	const devices = ['A', 'B'].map((id) => device({id}))
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), true)
	assert.equal(canDisconnectPoolMember(pool, 'A', []), false)
	assert.equal(canDisconnectPoolMember(pool, 'C', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, mirrors: undefined}, 'A', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, raidType: 'storage'}, 'A', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, status: 'FAULTED'}, 'A', devices), false)
	assert.equal(canDisconnectPoolMember(undefined, 'A', devices), false)
	assert.equal(canDisconnectPoolMember({...pool, dataErrors: 1}, 'A', devices), false)
})

test('RAIDZ and acceleration removal require their own surviving members', () => {
	const devices = ['A', 'B', 'SSD1', 'SSD2'].map((id) => device({id}))
	const pool = removalPool({topology: 'raidz', mirrors: undefined})
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), true)
	pool.devices![1].status = 'OFFLINE'
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
	const accelerator = {
		exists: true,
		devices: ['SSD1', 'SSD2'].map((id) => ({
			id,
			status: 'ONLINE' as const,
			readErrors: 0,
			writeErrors: 0,
			checksumErrors: 0,
		})),
	}
	assert.equal(canDisconnectPoolMember(removalPool({accelerator}), 'SSD1', devices), true)
	assert.equal(
		canDisconnectPoolMember(
			removalPool({accelerator: {...accelerator, devices: [accelerator.devices[0]]}}),
			'SSD1',
			devices,
		),
		false,
	)
})

test('unknown all-missing stripe media is not guessed to be SSD', () => {
	assert.equal(getPoolDeviceType(removalPool({topology: 'stripe'}), []), undefined)
})

test('swap guidance rejects an unhealthy survivor and malformed duplicate-member topology', () => {
	const pool = removalPool()
	const devices = ['A', 'B'].map((id) => device({id}))
	pool.devices![1].readErrors = 1
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
	pool.devices![1].readErrors = 0
	devices[1].smartStatus = 'unhealthy'
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
	pool.mirrors = [['A', 'A']]
	assert.equal(canDisconnectPoolMember(pool, 'A', devices), false)
})

test('known server-side work blocks removal before progress subscriptions catch up', () => {
	const devices = ['A', 'B'].map((id) => device({id}))
	for (const operation of [
		{rebuild: {state: 'rebuilding', progress: 12}},
		{expansion: {state: 'expanding', progress: 12}},
		{replace: {state: 'rebuilding', progress: 12}},
		{scrub: {state: 'scrubbing', progress: 12, errors: 0}},
		{failsafeTransitionStatus: {state: 'syncing', progress: 12}},
	] as Partial<RaidStatus>[])
		assert.equal(canDisconnectPoolMember(removalPool(operation), 'A', devices), false)
})
