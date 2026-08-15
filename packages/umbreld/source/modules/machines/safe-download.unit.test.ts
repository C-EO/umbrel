import {describe, expect, test} from 'vitest'

import {createPinnedLookup, isPrivateAddress} from './safe-download.js'

describe('machine image download SSRF protection', () => {
	test.each([
		'127.0.0.1',
		'10.0.0.1',
		'172.16.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'::1',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
	])('blocks %s', (address) => expect(isPrivateAddress(address)).toBe(true))

	test.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('allows %s', (address) =>
		expect(isPrivateAddress(address)).toBe(false),
	)

	test('returns the pinned address in the multi-address shape requested by modern Node HTTP clients', async () => {
		const pinned = {address: '1.1.1.1', family: 4}
		const result = await new Promise((resolve, reject) => {
			createPinnedLookup(pinned)('cloud-images.ubuntu.com', {all: true}, (error, addresses) => {
				if (error) return reject(error)
				resolve(addresses)
			})
		})

		expect(result).toEqual([pinned])
	})
})
