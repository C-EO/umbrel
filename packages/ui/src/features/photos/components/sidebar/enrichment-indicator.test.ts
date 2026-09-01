// @vitest-environment jsdom

import {expect, test} from 'vitest'

import {indicatorState} from './enrichment-indicator'

test('shows only during enrichment', () => {
	expect(indicatorState(undefined)).toBeNull()
	expect(indicatorState({phase: 'ready', completed: 10, total: 10, percentage: 100})).toBeNull()
	// Indexing is the timeline's full-screen state and degraded is its
	// footer's story — neither echoes in the sidebar
	expect(indicatorState({phase: 'indexing'})).toBeNull()
	expect(indicatorState({phase: 'degraded', completed: 5, total: 10, percentage: 50})).toBeNull()
})

test('fills a progress ring through 95%', () => {
	expect(indicatorState({phase: 'enriching', completed: 0, total: 10, percentage: 0})).toEqual({
		kind: 'ring',
		percentage: 0,
	})
	expect(indicatorState({phase: 'enriching', completed: 5, total: 10, percentage: 50})).toEqual({
		kind: 'ring',
		percentage: 50,
	})
	expect(indicatorState({phase: 'enriching', completed: 19, total: 20, percentage: 95})).toEqual({
		kind: 'ring',
		percentage: 95,
	})
})

test('hands over to a spinner above 95%, where the ring would look done', () => {
	expect(indicatorState({phase: 'enriching', completed: 96, total: 100, percentage: 96})).toEqual({
		kind: 'spinner',
		percentage: 96,
	})
})
