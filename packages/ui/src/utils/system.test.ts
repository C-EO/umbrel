import {describe, expect, test} from 'vitest'

import {isTrpcDiskLow, trpcDiskToLocal} from './system'

describe('disk availability', () => {
	test('uses backend availability instead of recomputing size minus used', () => {
		const disk = {
			size: 100,
			totalUsed: 80,
			available: 10,
		} as Parameters<typeof trpcDiskToLocal>[0]

		expect(trpcDiskToLocal(disk)?.available).toBe(10)
	})

	test('uses backend availability for the low-disk threshold', () => {
		const disk = {
			size: 4_000_000_000_000,
			totalUsed: 3_980_000_000_000,
			available: 900_000_000,
		} as Parameters<typeof isTrpcDiskLow>[0]

		expect(isTrpcDiskLow(disk)).toBe(true)
	})
})
