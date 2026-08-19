import {beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import App, {readManifestInDirectory} from './app.js'
import Apps from './apps.js'
import type {AppManifest} from './schema.js'

vi.mock('./app.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./app.js')>()),
	readManifestInDirectory: vi.fn(),
}))

function createApps(umbrelVersion: string) {
	const assertAppPortAvailable = vi.fn()
	const umbreld = {
		version: umbrelVersion,
		dataDirectory: '/tmp/manifest-compatibility-test',
		logger: {
			createChildLogger: () => ({log: vi.fn(), error: vi.fn()}),
		},
		appStore: {
			getAppTemplateFilePath: vi.fn(async () => '/app-template'),
		},
		machines: {assertAppPortAvailable},
	} as unknown as Umbreld

	return {apps: new Apps(umbreld), assertAppPortAvailable}
}

beforeEach(() => {
	vi.mocked(readManifestInDirectory).mockReset()
})

describe('manifest compatibility', () => {
	test('allows an update requiring the release version on an OS prerelease', async () => {
		const {apps} = createApps('2.0.0-beta.1')
		const update = vi.fn(async () => true)
		apps.instances = [{id: 'test-app', state: 'ready', update} as unknown as App]
		vi.mocked(readManifestInDirectory).mockResolvedValue({manifestVersion: '2.0.0'} as AppManifest)

		await expect(apps.update('test-app')).resolves.toBe(true)
		expect(update).toHaveBeenCalledOnce()
	})

	test('rejects an incompatible update before touching the installed app', async () => {
		const {apps} = createApps('1.9.9')
		const update = vi.fn(async () => true)
		const installedApp = {id: 'test-app', state: 'ready', stateProgress: 0, update} as unknown as App
		apps.instances = [installedApp]
		vi.mocked(readManifestInDirectory).mockResolvedValue({manifestVersion: '2.0.0'} as AppManifest)

		await expect(apps.update('test-app')).rejects.toThrow('App manifest version not supported')
		expect(update).not.toHaveBeenCalled()
		expect(installedApp).toMatchObject({state: 'ready', stateProgress: 0})
	})

	test('rejects an incompatible install before beginning installation', async () => {
		const {apps, assertAppPortAvailable} = createApps('1.9.9')
		vi.mocked(readManifestInDirectory).mockResolvedValue({manifestVersion: '2.0.0', port: 3000} as AppManifest)

		await expect(apps.install('test-app')).rejects.toThrow('App manifest version not supported')
		expect(assertAppPortAvailable).not.toHaveBeenCalled()
		expect(apps.instances).toStrictEqual([])
	})
})
