// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {getAppStorageFolderUsage} from './use-app-storage-folder-tags'

type AppStorage = NonNullable<UserApp['storage']>

function createApp(
	id: string,
	name: string,
	{customMounts = [], folderAccess = []}: Pick<AppStorage, 'customMounts' | 'folderAccess'>,
): Pick<UserApp, 'id' | 'name' | 'icon' | 'storage'> {
	return {
		id,
		name,
		icon: `https://example.test/${id}.svg`,
		storage: {
			dataRoot: null,
			occupiedTargets: [],
			customMounts,
			folderAccess,
			services: [],
			serviceImages: {},
			missingSourcePaths: [],
		},
	}
}

describe('getAppStorageFolderUsage', () => {
	test('collects every app using a custom or app-suggested folder, with its icon', () => {
		const usage = getAppStorageFolderUsage([
			createApp('jellyfin', 'Jellyfin', {
				customMounts: [
					{
						serviceName: 'server',
						targetPath: '/media',
						sourcePath: '/Home/Media/',
						readOnly: true,
					},
				],
				folderAccess: [],
			}),
			createApp('plex', 'Plex', {
				customMounts: [],
				folderAccess: [
					{
						id: 'media',
						name: 'Media',
						mounts: [{serviceName: 'server', targetPath: '/media', readOnly: true}],
						defaultSourcePath: '/Home/Media',
						sourcePath: null,
					},
				],
			}),
		])

		expect(usage.usedByPaths.get('/Home/Media')).toEqual([
			{id: 'jellyfin', name: 'Jellyfin', icon: 'https://example.test/jellyfin.svg'},
			{id: 'plex', name: 'Plex', icon: 'https://example.test/plex.svg'},
		])
	})

	test('lists an app once per folder even when several of its mounts share the source', () => {
		const usage = getAppStorageFolderUsage([
			createApp('jellyfin', 'Jellyfin', {
				customMounts: [
					{serviceName: 'server', targetPath: '/movies', sourcePath: '/Home/Media', readOnly: true},
					{serviceName: 'server', targetPath: '/shows', sourcePath: '/Home/Media', readOnly: true},
				],
				folderAccess: [],
			}),
		])

		expect(usage.usedByPaths.get('/Home/Media')?.map((app) => app.id)).toEqual(['jellyfin'])
	})

	test('ignores app-suggested folders the user has not selected', () => {
		const usage = getAppStorageFolderUsage([
			createApp('music', 'Music', {
				customMounts: [],
				folderAccess: [
					{
						id: 'music',
						name: 'Music',
						mounts: [{serviceName: 'server', targetPath: '/music', readOnly: true}],
						defaultSourcePath: null,
						sourcePath: null,
					},
				],
			}),
		])

		expect(usage.usedByPaths.size).toBe(0)
	})
})
