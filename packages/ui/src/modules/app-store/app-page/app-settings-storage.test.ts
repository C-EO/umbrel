// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {
	areCustomMountsEqual,
	areFolderAccessEqual,
	getCustomMountConflictKeys,
	getDataRootMoveWarning,
	isDataRootParentSelectable,
	isExt4AppDataRootPath,
	type AppCustomMount,
	type AppFolderAccessSelection,
} from './app-settings-storage'

const firstMount: AppCustomMount = {
	serviceName: 'server',
	targetPath: '/media',
	sourcePath: '/Home/Media',
	readOnly: true,
}

const secondMount: AppCustomMount = {
	serviceName: 'worker',
	targetPath: '/downloads',
	sourcePath: '/Home/Downloads',
	readOnly: false,
}

describe('storage settings equality', () => {
	test('compares custom mounts independently of array order', () => {
		expect(areCustomMountsEqual([firstMount, secondMount], [secondMount, firstMount])).toBe(true)
		expect(areCustomMountsEqual([firstMount], [{...firstMount, sourcePath: '/Home/Other'}])).toBe(false)
	})

	test('compares app-suggested folder selections by id', () => {
		const music: AppFolderAccessSelection = {id: 'music', sourcePath: '/Home/Music'}
		const photos: AppFolderAccessSelection = {id: 'photos', sourcePath: '/Home/Photos'}

		expect(areFolderAccessEqual([music, photos], [photos, music])).toBe(true)
		expect(areFolderAccessEqual([music], [{...music, sourcePath: '/Home/Other'}])).toBe(false)
	})
})

describe('advanced mount conflicts', () => {
	test('only reserves an app-suggested target after the user selects that folder', () => {
		const mediaSlot = {
			id: 'media',
			mounts: [{serviceName: 'server', targetPath: '/media'}],
		}

		expect(getCustomMountConflictKeys([mediaSlot], [], [])).not.toContain('server:/media')
		expect(getCustomMountConflictKeys([mediaSlot], [{id: 'media'}], [])).toContain('server:/media')
		expect(getCustomMountConflictKeys([mediaSlot], [], [firstMount])).toContain('server:/media')
	})
})

describe('app storage destination folders', () => {
	test('allows any folder within an external drive', () => {
		expect(isDataRootParentSelectable({path: '/External/SSD'})).toBe(true)
		expect(isDataRootParentSelectable({path: '/External/SSD/My Apps/Fast Storage'})).toBe(true)
	})

	test('rejects storage groupings, network shares, and internal folders', () => {
		expect(isDataRootParentSelectable({path: '/External'})).toBe(false)
		expect(isDataRootParentSelectable({path: '/Network/nas'})).toBe(false)
		expect(isDataRootParentSelectable({path: '/Network/nas/media'})).toBe(false)
		expect(isDataRootParentSelectable({path: '/Network/nas/media/Umbrel Apps'})).toBe(false)
		expect(isDataRootParentSelectable({path: '/Home/Apps'})).toBe(false)
	})
})

describe('data root move warnings', () => {
	const disks = [
		{
			partitions: [
				{supportsAppDataRoot: false, mountpoints: ['/External/FAT']},
				{supportsAppDataRoot: true, mountpoints: ['/External/SSD']},
				{supportsAppDataRoot: false, mountpoints: ['/External/BTRFS']},
			],
		},
	]

	test('only accepts ext4, anywhere on the partition', () => {
		expect(isExt4AppDataRootPath('/External/SSD', disks)).toBe(true)
		expect(isExt4AppDataRootPath('/External/SSD/My Apps', disks)).toBe(true)
		expect(isExt4AppDataRootPath('/External/FAT', disks)).toBe(false)
		expect(isExt4AppDataRootPath('/External/BTRFS', disks)).toBe(false)
	})

	test('warns about unsupported filesystems, anywhere on the partition', () => {
		expect(getDataRootMoveWarning('/External/FAT', disks)).toBe('unsupported-filesystem')
		expect(getDataRootMoveWarning('/External/FAT/My Apps', disks)).toBe('unsupported-filesystem')
		expect(getDataRootMoveWarning('/External/BTRFS', disks)).toBe('unsupported-filesystem')
	})

	test('fails closed for unknown and similarly prefixed mountpoints', () => {
		expect(isExt4AppDataRootPath('/External/SSD2', disks)).toBe(false)
		expect(getDataRootMoveWarning('/External/SSD2', disks)).toBe('unsupported-filesystem')
	})

	test('falls back to the removable warning', () => {
		expect(getDataRootMoveWarning('/External/SSD', disks)).toBe('removable')
		expect(getDataRootMoveWarning('/Network/nas/media', disks)).toBeNull()
	})

	test('never warns when moving back to internal storage', () => {
		expect(getDataRootMoveWarning(null, disks)).toBeNull()
	})
})
