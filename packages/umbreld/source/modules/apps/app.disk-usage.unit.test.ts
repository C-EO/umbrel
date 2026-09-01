import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import App from './app.js'

function fixture() {
	const error = vi.fn()
	const getDirectorySize = vi.fn()
	const umbreld = {
		dataDirectory: '/tmp/umbreld-app-disk-usage-test',
		logger: {createChildLogger: () => ({error})},
		files: {getDirectorySize},
	} as unknown as Umbreld
	return {app: new App(umbreld, 'example-app'), error, getDirectorySize}
}

test('gets app disk usage through the indexed Files directory-size boundary', async () => {
	const {app, getDirectorySize} = fixture()
	getDirectorySize.mockResolvedValue(123)

	await expect(app.getDiskUsage()).resolves.toBe(123)
	expect(getDirectorySize).toHaveBeenCalledWith('/Apps/example-app')
})

test('keeps the existing zero result when app disk usage cannot be read', async () => {
	const {app, error, getDirectorySize} = fixture()
	getDirectorySize.mockRejectedValue(new Error('unavailable'))

	await expect(app.getDiskUsage()).resolves.toBe(0)
	expect(error).toHaveBeenCalledWith('Failed to get disk usage for app example-app', expect.any(Error))
})
