import {describe, expect, test} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {getAppWarning} from './app-warnings'

function app(storage: UserApp['storage'], state: UserApp['state'] = 'unknown') {
	return {state, storage} as UserApp
}

function storage({
	dataRoot = null,
	missingSourcePaths = [],
}: {
	dataRoot?: NonNullable<UserApp['storage']>['dataRoot']
	missingSourcePaths?: string[]
} = {}): NonNullable<UserApp['storage']> {
	return {
		dataRoot,
		customMounts: [],
		folderAccess: [],
		services: [],
		occupiedTargets: [],
		serviceImages: {},
		missingSourcePaths,
	}
}

describe('getAppWarning()', () => {
	test('distinguishes unavailable app storage from folder access', () => {
		expect(
			getAppWarning(
				app(
					storage({
						dataRoot: {
							location: '/External/Drive/My Apps/immich',
							canMoveExternally: true,
							status: 'storage-unavailable',
						},
						missingSourcePaths: ['/Home/Media'],
					}),
				),
			),
		).toBe('app-storage')

		expect(getAppWarning(app(storage({missingSourcePaths: ['/Home/Media']}), 'ready'))).toBe('folder-access')
	})

	test('distinguishes missing app data and reports it in every lifecycle state', () => {
		expect(
			getAppWarning(
				app(
					storage({
						dataRoot: {
							location: '/External/Drive/My Apps/immich',
							canMoveExternally: true,
							status: 'data-missing',
						},
					}),
					'stopped',
				),
			),
		).toBe('app-data-missing')
	})

	test('does not report unavailable storage while the status check is still running', () => {
		expect(
			getAppWarning(
				app(
					storage({
						dataRoot: {
							location: '/Network/nas/My Apps/immich',
							canMoveExternally: true,
							status: 'checking',
						},
					}),
					'ready',
				),
			),
		).toBeNull()
	})
})
