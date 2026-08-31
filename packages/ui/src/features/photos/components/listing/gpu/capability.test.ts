import {describe, expect, it} from 'vitest'

import {TILE_SIZE} from '@/features/photos/components/listing/timeline-rows'

import {
	atlasPlan,
	bandFor,
	bandItems,
	cellAt,
	cellFor,
	cellForBand,
	CELLS,
	retierMap,
	slotCount,
	slotsPerLayer,
} from './capability'

const LAPTOP = {width: 1150, height: 900}
const PHONE = {width: 390, height: 700}
const FIVE_K = {width: 2560, height: 1440}
// What a WebGL2 implementation is required to offer, which is also the least
// we ever plan for
const MODEST = {maxTextureSize: 2048, maxLayers: 256}

const desktop = {floor: TILE_SIZE.desktop.floor, min: TILE_SIZE.desktop.min}
const mobile = {floor: TILE_SIZE.mobile.floor, min: TILE_SIZE.mobile.min}

describe('cellFor', () => {
	it('never magnifies a cell', () => {
		for (const dpr of [1, 2, 3]) {
			for (let tile = 8; tile <= 48; tile++) {
				const cell = cellFor(tile, dpr)
				expect(cell === 256 || cell >= tile * dpr).toBe(true)
				expect(CELLS).toContain(cell)
			}
		}
	})

	it('never minifies one by more than a third', () => {
		for (const dpr of [2, 3]) {
			for (let tile = 11; tile <= 48; tile++) {
				const want = tile * dpr
				if (want < CELLS[0]!) continue
				expect(cellFor(tile, dpr) / want).toBeLessThanOrEqual(4 / 3 + 1e-9)
			}
		}
	})

	it('lands where the ends of the band need it to', () => {
		expect(cellFor(14, 2)).toBe(32)
		expect(cellFor(12, 3)).toBe(40)
		expect(cellFor(48, 2)).toBe(96)
		expect(cellFor(400, 3)).toBe(256)
	})
})

describe('cellAt', () => {
	it('lays cells out row by row, then layer by layer', () => {
		expect(cellAt(0, 2048, 32)).toEqual({layer: 0, x: 0, y: 0})
		expect(cellAt(1, 2048, 32)).toEqual({layer: 0, x: 32, y: 0})
		expect(cellAt(64, 2048, 32)).toEqual({layer: 0, x: 0, y: 32})
		expect(cellAt(4096, 2048, 32)).toEqual({layer: 1, x: 0, y: 0})
		expect(slotsPerLayer(2048, 48)).toBe(42 * 42)
		expect(slotsPerLayer(2048, 80)).toBe(25 * 25)
	})
})

describe('atlasPlan', () => {
	it('reaches the desktop floor on a laptop and a 5K desktop', () => {
		expect(atlasPlan(LAPTOP, 2, MODEST, desktop)?.floor).toBe(TILE_SIZE.desktop.floor)
		expect(atlasPlan(FIVE_K, 2, MODEST, desktop)?.floor).toBe(TILE_SIZE.desktop.floor)
	})

	it('reaches the mobile floor on a phone', () => {
		expect(atlasPlan(PHONE, 3, MODEST, mobile)?.floor).toBe(TILE_SIZE.mobile.floor)
	})

	it('raises the floor rather than overflowing when the layers run out', () => {
		const tight = atlasPlan(LAPTOP, 2, {maxTextureSize: 2048, maxLayers: 2}, desktop)
		expect(tight).not.toBeNull()
		expect(tight!.layers).toBe(2)
		expect(tight!.floor).toBeGreaterThan(TILE_SIZE.desktop.floor)
		expect(tight!.floor).toBeLessThan(TILE_SIZE.desktop.min)
	})

	it('spends a shortfall on softer cells rather than on a smaller zoom range', () => {
		const tight = atlasPlan(LAPTOP, 2, {maxTextureSize: 2048, maxLayers: 2}, desktop)!
		const band = bandFor(LAPTOP)
		// A tile whose ideal cell the two layers cannot hold a bandful of
		expect(cellForBand(25, 2, tight, band)).toBeLessThan(cellFor(25, 2))
		const roomy = atlasPlan(LAPTOP, 2, MODEST, desktop)!
		expect(cellForBand(25, 2, roomy, band)).toBe(cellFor(25, 2))
	})

	it('gives up rather than lying when even the seam will not fit', () => {
		expect(atlasPlan(FIVE_K, 3, {maxTextureSize: 1024, maxLayers: 1}, desktop)).toBeNull()
		expect(atlasPlan({width: 0, height: 0}, 2, MODEST, desktop)).toBeNull()
	})

	it('always leaves a slot for every item in the band, at every tile it offers', () => {
		for (const [viewport, dpr, bounds, limits] of [
			[LAPTOP, 2, desktop, MODEST],
			[PHONE, 3, mobile, MODEST],
			[FIVE_K, 2, desktop, MODEST],
			[LAPTOP, 1, desktop, MODEST],
			[LAPTOP, 2, desktop, {maxTextureSize: 2048, maxLayers: 2}],
		] as const) {
			const plan = atlasPlan(viewport, dpr, limits, bounds)!
			expect(plan).not.toBeNull()
			const band = bandFor(viewport)
			for (let tile = plan.floor; tile <= bounds.min; tile++) {
				expect(slotCount(plan, cellForBand(tile, dpr, plan, band))).toBeGreaterThanOrEqual(bandItems(band, tile))
			}
		}
	})

	it('stays inside a texture budget a browser will not blink at', () => {
		for (const [viewport, dpr, bounds] of [
			[LAPTOP, 2, desktop],
			[PHONE, 3, mobile],
			[FIVE_K, 2, desktop],
		] as const) {
			const plan = atlasPlan(viewport, dpr, MODEST, bounds)!
			expect(plan.layers * plan.side * plan.side * 4).toBeLessThanOrEqual(192 * 1024 * 1024)
		}
	})
})

describe('slot residency', () => {
	it('gives every item in a bandful of contiguous indices a distinct slot', () => {
		const plan = atlasPlan(LAPTOP, 2, MODEST, desktop)!
		const band = bandFor(LAPTOP)
		for (const tile of [14, 17, 25, 33, 48]) {
			const slots = slotCount(plan, cellForBand(tile, 2, plan, band))
			const count = bandItems(band, tile)
			const seen = new Set<number>()
			for (let index = 12_345; index < 12_345 + count; index++) seen.add(index % slots)
			expect(seen.size).toBe(count)
		}
	})
})

describe('retierMap', () => {
	const ids = (index: number) => `photo-${index}`

	it('carries every cell the band still wants to its new slot', () => {
		// 100 slots before, 400 after: the band is indices 500…599
		const resident = new Array<string | undefined>(100)
		for (let index = 500; index <= 599; index++) resident[index % 100] = ids(index)
		const moves = retierMap(resident, 400, {start: 500, end: 599}, ids)
		expect(moves).toHaveLength(100)
		expect(moves[0]).toEqual({from: 0, to: 100, id: 'photo-500'})
		expect(new Set(moves.map((move) => move.to)).size).toBe(100)
	})

	it('leaves behind cells holding something else, or nothing', () => {
		const resident = new Array<string | undefined>(100)
		resident[0] = ids(500)
		resident[1] = 'a-photo-from-another-scroll'
		const moves = retierMap(resident, 400, {start: 500, end: 599}, ids)
		expect(moves).toEqual([{from: 0, to: 100, id: 'photo-500'}])
	})

	it('is empty when there is no atlas to carry across', () => {
		expect(retierMap([], 400, {start: 0, end: 10}, ids)).toEqual([])
	})
})
