import {describe, expect, test} from 'vitest'

import {syntheticOwnershipMountOptions} from './external-storage.js'

describe('syntheticOwnershipMountOptions', () => {
	test.each(['exfat', 'vfat', 'ntfs', 'ntfs3', 'EXFAT'])('shares %s mounts with the Files group', (filesystem) => {
		expect(syntheticOwnershipMountOptions(filesystem, 1000, 1000)).toBe('uid=1000,gid=1000,fmask=0007,dmask=0007')
	})

	test.each(['ext4', 'xfs', 'btrfs', 'unknown'])('preserves native ownership for %s', (filesystem) => {
		expect(syntheticOwnershipMountOptions(filesystem, 1000, 1000)).toBeUndefined()
	})
})
