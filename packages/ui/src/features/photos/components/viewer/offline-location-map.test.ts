import {describe, expect, test, vi} from 'vitest'

import {
	buildMapModel,
	createProjection,
	fetchOfflineMapData,
	locationName,
	OFFLINE_MAP_DATA_URL,
	type OfflineMapData,
} from './offline-location-map'

const atlas: OfflineMapData = {
	version: 1,
	source: 'test',
	c: [
		[
			'Thailand',
			'TH',
			[95, 5, 106, 21],
			[
				[
					[95, 5],
					[106, 5],
					[106, 21],
					[95, 21],
					[95, 5],
				],
			],
		],
	],
	s: [
		[
			[99, 12, 102, 15],
			[
				[99, 13],
				[102, 14],
			],
		],
	],
	r: [
		[
			[99, 12, 102, 15],
			[
				[99, 12.5],
				[102, 14.5],
			],
		],
	],
	p: [
		[100.5018, 13.7563, 'Bangkok', 'Bangkok', 'TH', 10_900_000, 1],
		[100.2, 13.2, 'Nearby', 'Central', 'TH', 50_000, 7],
	],
}

describe('offline map resources', () => {
	test('loads its only data resource from the Umbrel origin', async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify(atlas), {status: 200}))
		const loaded = await fetchOfflineMapData(fetcher as typeof fetch)

		expect(OFFLINE_MAP_DATA_URL).toMatch(/^\//)
		expect(OFFLINE_MAP_DATA_URL).not.toMatch(/^https?:/)
		expect(fetcher).toHaveBeenCalledWith(OFFLINE_MAP_DATA_URL, {credentials: 'same-origin'})
		expect(loaded.version).toBe(1)
	})
})

describe('offline map projection', () => {
	test('keeps the photographed coordinate at the center', () => {
		const projection = createProjection(13.7563, 100.5018)
		expect(projection.point([100.5018, 13.7563])).toEqual([160, 72])
	})

	test('takes the short way across the antimeridian', () => {
		const projection = createProjection(0, 179)
		const [x] = projection.point([-179, 0])
		expect(x).toBeGreaterThan(160)
		expect(x).toBeLessThan(220)
	})
})

describe('offline place context', () => {
	test('names a nearby place and country without a geocoder request', () => {
		expect(locationName(atlas, 13.7563, 100.5018, 'en')).toBe('Bangkok, Thailand')
	})

	test('builds visible land, boundary, and road paths from the bundled atlas', () => {
		const model = buildMapModel(atlas, 13.7563, 100.5018, 'en')
		expect(model.countries).toContain('M')
		expect(model.regions).toContain('M')
		expect(model.roads).toContain('M')
		expect(model.place).toBe('Bangkok, Thailand')
	})
})
