// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {isFolderAccessSourceSelectable, storagePathsOverlap} from './storage-paths'

describe('folder access source paths', () => {
	test('allows real folders but not storage grouping rows', () => {
		expect(isFolderAccessSourceSelectable({path: '/Home'})).toBe(true)
		expect(isFolderAccessSourceSelectable({path: '/Home/Downloads'})).toBe(true)
		expect(isFolderAccessSourceSelectable({path: '/External'})).toBe(false)
		expect(isFolderAccessSourceSelectable({path: '/External/USB'})).toBe(true)
		expect(isFolderAccessSourceSelectable({path: '/Network/nas'})).toBe(false)
		expect(isFolderAccessSourceSelectable({path: '/Network/nas/media'})).toBe(true)
		expect(isFolderAccessSourceSelectable({path: '/etc'})).toBe(false)
	})

	test('recognizes paths inside an app-managed data root', () => {
		expect(storagePathsOverlap('/External/USB/Apps/memos', '/External/USB/Apps/memos')).toBe(true)
		expect(storagePathsOverlap('/External/USB/Apps/memos/files', '/External/USB/Apps/memos')).toBe(true)
		expect(storagePathsOverlap('/External/USB/Media', '/External/USB/Apps/memos')).toBe(false)
	})
})
