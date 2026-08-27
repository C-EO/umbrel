import {describe, expect, test} from 'vitest'

import {buildGridLayout, countGridColumns, EMPTY_RANGE, rowTop, sameRange, visibleRowRange} from './virtual-grid'

const layout = (count: number, columns = 3) => buildGridLayout({count, columns, rowHeight: 76, gap: 4})

describe('buildGridLayout', () => {
	test('chunks cards into rows and ends without a trailing gap', () => {
		const l = layout(10)
		expect(l.rows).toBe(4)
		expect(l.pitch).toBe(80)
		expect(l.total).toBe(4 * 80 - 4)
		expect(rowTop(l, 0)).toBe(0)
		expect(rowTop(l, 3)).toBe(240)
	})

	test('an exact multiple fills its last row', () => {
		expect(layout(9).rows).toBe(3)
	})

	test('an empty grid has no height', () => {
		expect(layout(0)).toMatchObject({rows: 0, total: 0})
	})

	test('never divides by fewer than one column', () => {
		expect(layout(5, 0)).toMatchObject({columns: 1, rows: 5})
		expect(layout(5, 2.9)).toMatchObject({columns: 2, rows: 3})
	})
})

describe('visibleRowRange', () => {
	// 100 rows, 80px pitch: rows 0..99 at 0, 80, 160, …
	const l = layout(300)

	test('the viewport at the top of the grid shows the first rows', () => {
		expect(visibleRowRange(l, {offset: 0, scrollTop: 0, viewport: 400, overscan: 0})).toEqual({start: 0, end: 4})
	})

	test('rows are inclusive at their top edge and exclusive at their bottom', () => {
		// Row 0 spans [0, 76): a window starting exactly at 76 no longer needs it
		expect(visibleRowRange(l, {offset: 0, scrollTop: 76, viewport: 5, overscan: 0})).toEqual({start: 1, end: 1})
		// … and one starting at 75 still does
		expect(visibleRowRange(l, {offset: 0, scrollTop: 75, viewport: 5, overscan: 0})).toEqual({start: 0, end: 0})
		// A window entirely inside the gap between two rows needs neither
		expect(visibleRowRange(l, {offset: 0, scrollTop: 76, viewport: 4, overscan: 0})).toEqual(EMPTY_RANGE)
		// A window ending exactly at row 5's top (400) doesn't include it
		expect(visibleRowRange(l, {offset: 0, scrollTop: 0, viewport: 400, overscan: 0}).end).toBe(4)
		expect(visibleRowRange(l, {offset: 0, scrollTop: 0, viewport: 401, overscan: 0}).end).toBe(5)
	})

	test('the offset places the grid below other content', () => {
		// Grid starts 1000px down; the viewport hasn't reached it yet
		expect(visibleRowRange(l, {offset: 1000, scrollTop: 0, viewport: 800, overscan: 0})).toEqual(EMPTY_RANGE)
		// … now its first 3 rows peek in
		expect(visibleRowRange(l, {offset: 1000, scrollTop: 400, viewport: 800, overscan: 0})).toEqual({start: 0, end: 2})
		expect(visibleRowRange(l, {offset: 1000, scrollTop: 1000, viewport: 800, overscan: 0})).toEqual({start: 0, end: 9})
	})

	test('overscan extends the window on both sides', () => {
		expect(visibleRowRange(l, {offset: 0, scrollTop: 800, viewport: 400, overscan: 160})).toEqual({start: 8, end: 16})
		// … and clamps at the grid's edges
		expect(visibleRowRange(l, {offset: 0, scrollTop: 0, viewport: 400, overscan: 1000})).toEqual({start: 0, end: 17})
		expect(visibleRowRange(l, {offset: 0, scrollTop: 7900, viewport: 400, overscan: 1000})).toEqual({
			start: 86,
			end: 99,
		})
	})

	test('is empty past the end of the grid, at negative scroll positions before it, and for an empty grid', () => {
		expect(visibleRowRange(l, {offset: 0, scrollTop: l.total, viewport: 400, overscan: 0})).toEqual(EMPTY_RANGE)
		expect(visibleRowRange(l, {offset: 0, scrollTop: 10_000, viewport: 400, overscan: 0})).toEqual(EMPTY_RANGE)
		expect(visibleRowRange(l, {offset: 500, scrollTop: -100, viewport: 400, overscan: 0})).toEqual(EMPTY_RANGE)
		expect(visibleRowRange(layout(0), {offset: 0, scrollTop: 0, viewport: 400, overscan: 600})).toEqual(EMPTY_RANGE)
	})

	test('rubber-banding above the top still starts at the first row', () => {
		expect(visibleRowRange(l, {offset: 0, scrollTop: -200, viewport: 400, overscan: 0})).toEqual({start: 0, end: 2})
	})

	test('every card is covered exactly once by consecutive windows', () => {
		const seen = new Map<number, number>()
		for (let scrollTop = 0; scrollTop < l.total; scrollTop += 80) {
			const {start, end} = visibleRowRange(l, {offset: 0, scrollTop, viewport: 80, overscan: 0})
			for (let row = start; row <= end; row++) seen.set(row, (seen.get(row) ?? 0) + 1)
		}
		expect(seen.size).toBe(l.rows)
		expect(new Set(seen.values())).toEqual(new Set([1]))
	})
})

describe('sameRange', () => {
	test('compares by value', () => {
		expect(sameRange({start: 1, end: 2}, {start: 1, end: 2})).toBe(true)
		expect(sameRange({start: 1, end: 2}, {start: 1, end: 3})).toBe(false)
		expect(sameRange(EMPTY_RANGE, {start: 0, end: -1})).toBe(true)
	})
})

describe('countGridColumns', () => {
	test('counts resolved track sizes', () => {
		expect(countGridColumns('312px 312px 312px')).toBe(3)
		expect(countGridColumns('472.5px 472.5px')).toBe(2)
		expect(countGridColumns('1180px')).toBe(1)
	})

	test('ignores line names', () => {
		expect(countGridColumns('[start] 300px [mid] 300px [end]')).toBe(2)
	})

	test('a grid without explicit tracks has one column', () => {
		expect(countGridColumns('none')).toBe(1)
		expect(countGridColumns('')).toBe(1)
	})
})
