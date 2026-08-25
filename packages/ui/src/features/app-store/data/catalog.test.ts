// @vitest-environment jsdom
import {describe, expect, test, vi} from 'vitest'

import type {RegistryApp} from '@/trpc/trpc'

import {
	buildAppDates,
	buildAppStatusMap,
	createNameCollator,
	deriveAppStatus,
	getAppStoreAction,
	getAvailableSorts,
	getCategoryLabel,
	getNavCategories,
	getRelatedApps,
	sortApps,
} from './catalog'

vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))

const app = (overrides: Partial<RegistryApp>): RegistryApp => ({id: 'app', name: 'App', ...overrides}) as RegistryApp

describe('deriveAppStatus', () => {
	test('not installed', () => {
		expect(deriveAppStatus({compatible: true, updateAvailable: false})).toBe('available')
	})

	test('not installed and incompatible', () => {
		expect(deriveAppStatus({compatible: false, updateAvailable: false})).toBe('incompatible')
	})

	test('installed', () => {
		expect(deriveAppStatus({compatible: true, installedState: 'running', updateAvailable: false})).toBe('installed')
	})

	test('installed with update available', () => {
		expect(deriveAppStatus({compatible: true, installedState: 'ready', updateAvailable: true})).toBe('update-available')
	})

	test('in progress wins over update available', () => {
		expect(deriveAppStatus({compatible: true, installedState: 'updating', updateAvailable: true})).toBe('in-progress')
		expect(deriveAppStatus({compatible: true, installedState: 'installing', updateAvailable: false})).toBe(
			'in-progress',
		)
	})

	test('installed but incompatible manifest still reads installed', () => {
		expect(deriveAppStatus({compatible: false, installedState: 'running', updateAvailable: false})).toBe('installed')
	})
})

describe('buildAppStatusMap', () => {
	test('derives status only from the supplied registry entry when IDs overlap', () => {
		const officialApp = app({id: 'shared-id', appStoreId: 'umbrel-app-store', compatible: true})
		const unrelatedCommunityApp = app({id: 'shared-id', appStoreId: 'community-store', compatible: false})

		expect(buildAppStatusMap([officialApp], undefined).get('shared-id')).toBe('available')
		expect(buildAppStatusMap([unrelatedCommunityApp], undefined).get('shared-id')).toBe('incompatible')
	})
})

describe('getAppStoreAction', () => {
	test.each([
		['available', 'install'],
		['incompatible', 'install'],
		['installed', 'open'],
		['update-available', 'update'],
		['in-progress', undefined],
	] as const)('maps %s exhaustively to %s', (status, action) => {
		expect(getAppStoreAction(status, false)).toBe(action)
	})

	test('never offers an action while the live app state is transitioning', () => {
		expect(getAppStoreAction('available', true)).toBeUndefined()
		expect(getAppStoreAction('installed', true)).toBeUndefined()
		expect(getAppStoreAction('update-available', true)).toBeUndefined()
	})
})

describe('buildAppDates', () => {
	const local = {
		immich: {version: '2.0.0'},
		plex: {version: '1.5.0'},
	}

	test('applies createdAt unconditionally and updatedAt only on version match', () => {
		const dates = buildAppDates(
			[
				{id: 'immich', version: '2.0.0', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z'},
				// Remote is ahead of this device: updatedAt must not be applied
				{id: 'plex', version: '9.9.9', createdAt: '2023-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z'},
			],
			local,
		)

		expect(dates.get('immich')).toEqual({
			createdAt: Date.parse('2024-01-01T00:00:00Z'),
			updatedAt: Date.parse('2026-05-01T00:00:00Z'),
		})
		expect(dates.get('plex')).toEqual({createdAt: Date.parse('2023-01-01T00:00:00Z')})
	})

	test('drops unknown apps and invalid dates', () => {
		const dates = buildAppDates(
			[
				{id: 'not-local', version: '1.0.0', createdAt: '2024-01-01T00:00:00Z', updatedAt: null},
				{id: 'immich', version: '2.0.0', createdAt: 'not-a-date', updatedAt: undefined},
			],
			local,
		)

		expect(dates.size).toBe(0)
	})
})

describe('getAvailableSorts', () => {
	test('only name without remote dates', () => {
		expect(getAvailableSorts(undefined)).toEqual(['name'])
		expect(getAvailableSorts(new Map())).toEqual(['name'])
	})

	test('date sorts appear only when the metadata supports them', () => {
		expect(getAvailableSorts(new Map([['a', {createdAt: 1}]]))).toEqual(['name', 'newest'])
		expect(getAvailableSorts(new Map([['a', {updatedAt: 1}]]))).toEqual(['name', 'recently-updated'])
		expect(getAvailableSorts(new Map([['a', {createdAt: 1, updatedAt: 2}]]))).toEqual([
			'name',
			'newest',
			'recently-updated',
		])
	})
})

describe('sortApps', () => {
	const apps = [
		app({id: 'zebra', name: 'zebra'}),
		app({id: 'alpha', name: 'Alpha'}),
		app({id: 'numeric', name: 'App 10'}),
		app({id: 'numeric2', name: 'App 2'}),
	]

	test('name sort is case-insensitive and numeric-aware', () => {
		const sorted = sortApps(apps, 'name', undefined, createNameCollator('en'))
		expect(sorted.map(({name}) => name)).toEqual(['Alpha', 'App 2', 'App 10', 'zebra'])
	})

	test('is stable and does not mutate its input', () => {
		const input = [...apps]
		sortApps(input, 'name', undefined, createNameCollator('en'))
		expect(input).toEqual(apps)
	})

	test('newest puts undated apps last, alphabetically', () => {
		const dates = new Map([
			['alpha', {createdAt: 100}],
			['zebra', {createdAt: 200}],
		])
		const sorted = sortApps(apps, 'newest', dates, createNameCollator('en'))
		expect(sorted.map(({id}) => id)).toEqual(['zebra', 'alpha', 'numeric2', 'numeric'])
	})

	test('recently-updated orders by updatedAt descending', () => {
		const dates = new Map([
			['alpha', {updatedAt: 300}],
			['numeric', {updatedAt: 500}],
		])
		const sorted = sortApps(apps, 'recently-updated', dates, createNameCollator('en'))
		expect(sorted.map(({id}) => id)).toEqual(['numeric', 'alpha', 'numeric2', 'zebra'])
	})
})

describe('getCategoryLabel', () => {
	test('predefined categories use translations', () => {
		expect(getCategoryLabel('ai')).toBe('app-store.category.ai')
	})

	test('unknown manifest categories are title-cased', () => {
		expect(getCategoryLabel('home_lab-tools')).toBe('Home Lab Tools')
	})
})

describe('getNavCategories', () => {
	test('keeps canonical order, drops empty predefined categories, appends dynamic ones', () => {
		const nav = getNavCategories({
			ai: [{}],
			bitcoin: [],
			gaming: [{}],
		})

		expect(nav[0]).toBe('discover')
		expect(nav[1]).toBe('all')
		expect(nav).toContain('ai')
		expect(nav).not.toContain('bitcoin')
		expect(nav.at(-1)).toBe('gaming')
	})
})

describe('getRelatedApps', () => {
	const apps = [
		app({id: 'a', category: 'media'}),
		app({id: 'b', category: 'media'}),
		app({id: 'c', category: 'media'}),
		app({id: 'd', category: 'files'}),
	]

	test('returns same-category apps, excluding the app itself, deterministically', () => {
		const related = getRelatedApps(apps, 'a', 2)
		expect(related).toHaveLength(2)
		expect(related.map(({id}) => id)).not.toContain('a')
		expect(related.map(({id}) => id)).not.toContain('d')
		expect(getRelatedApps(apps, 'a', 2)).toEqual(related)
	})

	test('unknown app returns nothing', () => {
		expect(getRelatedApps(apps, 'missing')).toEqual([])
	})
})
