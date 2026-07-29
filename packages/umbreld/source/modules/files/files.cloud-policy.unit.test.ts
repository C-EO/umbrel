import {describe, expect, test, vi} from 'vitest'

import Files from './files.js'

function createFiles({
	authorize,
	destinations,
}: {
	authorize: (path: string, userId: string) => Promise<string>
	destinations: string[]
}) {
	const files = Object.create(Files.prototype) as Files
	const getDestinationPaths = vi.fn(() => destinations)
	Object.assign(files, {
		cloud: {getDestinationPaths},
		virtualToSystemPath: vi.fn(authorize),
	})
	return {files, getDestinationPaths}
}

describe('Cloud Files authorization boundary', () => {
	test('does not consult global Cloud destinations before authorizing a request path', async () => {
		const {files, getDestinationPaths} = createFiles({
			authorize: async () => {
				throw new Error('[forbidden]')
			},
			destinations: ['/Users/alice/Cloud'],
		})

		await expect(files.assertCloudMutablePath('/Users/alice/Cloud/report.txt', 'bob')).rejects.toThrow('[forbidden]')
		expect(getDestinationPaths).not.toHaveBeenCalled()
	})

	test('returns the Cloud read-only response after an accessible path is authorized', async () => {
		const {files, getDestinationPaths} = createFiles({
			authorize: async (path) => `/data${path}`,
			destinations: ['/Users/alice/Cloud'],
		})

		await expect(files.assertCloudMutablePath('/Users/alice/Cloud/report.txt', 'alice')).rejects.toThrow(
			'[cloud-read-only]',
		)
		expect(getDestinationPaths).toHaveBeenCalledOnce()
	})
})
