// @vitest-environment jsdom
import {describe, expect, test, vi} from 'vitest'

import {hasTimelineContent, parseAppReleases, reconcileReleases, type AppReleases} from './releases'

vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))

const localApp = {id: 'immich', version: '2.0.0', releaseNotes: 'Local notes for 2.0.0'}

const remote = (overrides: Partial<AppReleases> = {}): AppReleases => ({
	schemaVersion: 1,
	id: 'immich',
	version: '2.0.0',
	releases: [
		{version: '2.0.0', date: '2026-05-01T00:00:00Z', notes: 'Remote notes for 2.0.0'},
		{version: '1.9.0', date: '2026-03-01T00:00:00Z', notes: 'Remote notes for 1.9.0'},
		{version: '1.8.0', date: '2026-01-01T00:00:00Z', notes: ''},
	],
	...overrides,
})

describe('parseAppReleases', () => {
	test('accepts valid data and rejects malformed data', () => {
		expect(parseAppReleases(remote())).toBeTruthy()
		expect(() => parseAppReleases({schemaVersion: 1, id: 'x'})).toThrow()
		expect(() => parseAppReleases(null)).toThrow()
	})
})

describe('hasTimelineContent', () => {
	test('a single undated entry without notes is not worth showing', () => {
		expect(hasTimelineContent([])).toBe(false)
		expect(hasTimelineContent([{version: '1.0.0', notes: '  '}])).toBe(false)
	})

	test('notes, dates, or history make the timeline worth showing', () => {
		expect(hasTimelineContent([{version: '1.0.0', notes: 'Notes'}])).toBe(true)
		expect(hasTimelineContent([{version: '1.0.0', date: 1, notes: ''}])).toBe(true)
		expect(
			hasTimelineContent([
				{version: '1.1.0', notes: ''},
				{version: '1.0.0', notes: ''},
			]),
		).toBe(true)
	})
})

describe('reconcileReleases', () => {
	test('remote current version matches local: shows dated timeline', () => {
		const timeline = reconcileReleases(localApp, remote())
		expect(timeline).toHaveLength(3)
		expect(timeline[0]).toEqual({
			version: '2.0.0',
			date: Date.parse('2026-05-01T00:00:00Z'),
			notes: 'Remote notes for 2.0.0',
		})
	})

	test('remote ahead of local: only entries from the local version down are shown', () => {
		const ahead = remote({
			version: '2.0.0',
			releases: [
				{version: '2.1.0', date: '2026-06-01T00:00:00Z', notes: 'Not installable here'},
				{version: '2.0.0', date: '2026-05-01T00:00:00Z', notes: 'Current'},
				{version: '1.9.0', date: '2026-03-01T00:00:00Z', notes: 'Old'},
			],
		})
		const timeline = reconcileReleases(localApp, ahead)
		expect(timeline.map(({version}) => version)).toEqual(['2.0.0', '1.9.0'])
	})

	test('remote current version mismatch falls back to local notes only', () => {
		const timeline = reconcileReleases(localApp, remote({version: '3.0.0'}))
		expect(timeline).toEqual([{version: '2.0.0', notes: 'Local notes for 2.0.0'}])
	})

	test('remote data for a different app is discarded', () => {
		const timeline = reconcileReleases(localApp, remote({id: 'plex'}))
		expect(timeline).toEqual([{version: '2.0.0', notes: 'Local notes for 2.0.0'}])
	})

	test('missing remote data falls back to local notes', () => {
		expect(reconcileReleases(localApp, undefined)).toEqual([{version: '2.0.0', notes: 'Local notes for 2.0.0'}])
	})

	test('empty remote notes for the current version fall back to local notes', () => {
		const timeline = reconcileReleases(
			localApp,
			remote({
				releases: [{version: '2.0.0', date: '2026-05-01T00:00:00Z', notes: '  '}],
			}),
		)
		expect(timeline[0]?.notes).toBe('Local notes for 2.0.0')
	})

	test('local version missing from remote history falls back to local notes', () => {
		const timeline = reconcileReleases(
			localApp,
			remote({
				releases: [{version: '1.9.0', date: '2026-03-01T00:00:00Z', notes: 'Old'}],
			}),
		)
		expect(timeline).toEqual([{version: '2.0.0', notes: 'Local notes for 2.0.0'}])
	})
})
