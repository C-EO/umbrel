// @vitest-environment jsdom
import {describe, expect, test, vi} from 'vitest'

import type {RegistryApp} from '@/trpc/trpc'

import {createAppStoreSearch} from './search'

vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))

const app = (overrides: Partial<RegistryApp>): RegistryApp =>
	({
		id: 'app',
		name: 'App',
		tagline: '',
		description: '',
		developer: '',
		category: 'files',
		...overrides,
	}) as RegistryApp

const apps = [
	app({id: 'immich', name: 'Immich', tagline: 'High-performance photo backup', developer: 'Alex Tran'}),
	app({id: 'jellyfin', name: 'Jellyfin', tagline: 'The Free Software Media System', category: 'media'}),
	app({id: 'nextcloud', name: 'Nextcloud', tagline: 'Productivity platform', description: 'Sync photos and files'}),
]

describe('createAppStoreSearch', () => {
	const search = createAppStoreSearch(apps)

	test('matches by name first', () => {
		expect(search('immich')[0]?.id).toBe('immich')
	})

	test('name matches rank above description matches', () => {
		const results = search('photo')
		expect(results.map(({id}) => id)).toContain('immich')
		expect(results.map(({id}) => id)).toContain('nextcloud')
		// "photo" in Immich's tagline should outrank "photos" in Nextcloud's description
		expect(results[0]?.id).toBe('immich')
	})

	test('matches by developer', () => {
		expect(search('alex tran').map(({id}) => id)).toContain('immich')
	})

	test('matches by category label', () => {
		// The mocked t() returns the key, so the label for 'media' is 'app-store.category.media'
		expect(search('category.media').map(({id}) => id)).toContain('jellyfin')
	})

	test('empty and whitespace queries return nothing', () => {
		expect(search('')).toEqual([])
		expect(search('   ')).toEqual([])
	})
})
