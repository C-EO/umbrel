import {describe, expect, test} from 'vitest'

import {isEligibleExternalStorageDevice, syntheticOwnershipMountOptions} from './external-storage.js'

describe('isEligibleExternalStorageDevice', () => {
	test('excludes USB devices that report zero capacity', () => {
		expect(isEligibleExternalStorageDevice({id: 'sdb', transport: 'usb', size: 0}, new Set())).toBe(false)
	})

	test('keeps blank USB disks that report usable capacity', () => {
		expect(isEligibleExternalStorageDevice({id: 'sdb', transport: 'usb', size: 1_000_204_886_016}, new Set())).toBe(
			true,
		)
	})
})

describe('syntheticOwnershipMountOptions', () => {
	test.each(['exfat', 'vfat', 'ntfs', 'ntfs3', 'EXFAT'])('shares %s mounts with the Files group', (filesystem) => {
		expect(syntheticOwnershipMountOptions(filesystem, 1000, 1000)).toBe('uid=1000,gid=1000,fmask=0007,dmask=0007')
	})

	test.each(['ext4', 'xfs', 'btrfs', 'unknown'])('preserves native ownership for %s', (filesystem) => {
		expect(syntheticOwnershipMountOptions(filesystem, 1000, 1000)).toBeUndefined()
	})
})
