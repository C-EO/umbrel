// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {getActiveAppsUsingStoragePaths} from './storage-in-use'

function appInState(state: UserApp['state']) {
	return {
		id: 'test-app',
		name: 'Test App',
		state,
		storage: {
			dataRoot: null,
			folderAccess: [],
			customMounts: [
				{
					serviceName: 'app',
					targetPath: '/media',
					sourcePath: '/External/Drive/Media',
					readOnly: false,
				},
			],
		},
	} as unknown as UserApp
}

describe('storage in-use display', () => {
	test('only treats an explicitly stopped app as inactive', () => {
		expect(getActiveAppsUsingStoragePaths([appInState('unknown')], ['/External/Drive'])).toHaveLength(1)
		expect(getActiveAppsUsingStoragePaths([appInState('stopped')], ['/External/Drive'])).toHaveLength(0)
	})

	test("includes a running app that inherits a dependency's data root", () => {
		const provider = {
			...appInState('stopped'),
			id: 'provider',
			name: 'Provider',
			storage: {
				...appInState('stopped').storage,
				dataRoot: {
					location: '/External/Drive/Apps/provider',
					canMoveExternally: true,
					status: 'available',
				},
			},
		} as UserApp
		const consumer = {
			...appInState('ready'),
			id: 'consumer',
			name: 'Consumer',
			selectedDependencies: {provider: 'provider'},
			storage: {...appInState('ready').storage, customMounts: []},
		} as UserApp

		expect(getActiveAppsUsingStoragePaths([provider, consumer], ['/External/Drive']).map(({id}) => id)).toEqual([
			'consumer',
		])
	})
})
