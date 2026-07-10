import {fileURLToPath} from 'node:url'
import path from 'node:path'

import {describe, beforeAll, afterAll, expect, test, vi} from 'vitest'
import fse from 'fs-extra'

import runGitServer from '../test-utilities/run-git-server.js'
import temporaryDirectory from '../utilities/temporary-directory.js'

import AppRepository from './app-repository.js'
import Umbreld from '../../index.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const directory = temporaryDirectory()

let gitServer: Awaited<ReturnType<typeof runGitServer>>

beforeAll(async () => {
	await directory.createRoot()
	gitServer = await runGitServer()
})
afterAll(async () => {
	await directory.destroyRoot()
	await gitServer.close()
})

describe('AppRepository', async () => {
	test('is a class', () => {
		expect(AppRepository).toBeTypeOf('function')
		expect(AppRepository.toString().startsWith('class ')).toBe(true)
	})

	test('return an instance on valid URL', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const url = 'http://github.com/getumbrel/umbrel-apps.git'
		const appRepo = new AppRepository(umbreld, url)
		expect(appRepo.url).toBe(url)
	})

	test('throws error on invalid URL', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		expect(() => new AppRepository(umbreld, 'invalid-url')).toThrow('Invalid URL')
	})
})

describe('appRepository.cleanUrl()', () => {
	test('cleans HTTP URLs', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'http://github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-98f08343')
	})

	test('cleans HTTPS URLs', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-53f74447')
	})

	test('cleans token URLs', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://somerandomtoken@github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-5db4a3e5')
	})

	test('cleans GitLab URL', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://gitlab.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-gitlab-8895504e')
	})

	test('cleans non user/repo urls', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://example.com')
		expect(appRepo.cleanUrl()).toBe('example-100680ad')
	})

	test('removes dangerous characters', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, `https://example.com/-+_)(*&^%$!~\`,<>?;:'"[{]}\\|=/`)
		expect(appRepo.cleanUrl()).toBe('example-fcd4912b')
	})
})

describe('appRepository.update()', () => {
	test("does initial install from URL if there's no local repo", async () => {
		const dataDirectory = await directory.create()
		const umbreld = new Umbreld({dataDirectory})
		const appRepository = new AppRepository(umbreld, gitServer.url)
		expect(await fse.exists(`${appRepository.path}/.git`)).toBe(false)
		expect(await fse.exists(`${appRepository.path}/umbrel-app-store.yml`)).toBe(false)
		await appRepository.update()
		expect(await fse.exists(`${appRepository.path}/.git`)).toBe(true)
		expect(await fse.exists(`${appRepository.path}/umbrel-app-store.yml`)).toBe(true)
	})

	test('updates when the remote repo has changed', async () => {
		const dataDirectory = await directory.create()
		const umbreld = new Umbreld({dataDirectory})
		const appRepository = new AppRepository(umbreld, gitServer.url)

		// Initial install
		await appRepository.update()
		const originalCommit = await appRepository.getCurrentCommit()
		expect(originalCommit).toBeTruthy()

		// Check we are updated
		expect(await appRepository.isUpdated()).toBe(true)

		// Add new commit to remote repo
		await gitServer.addNewCommit()

		// Check we are not updated
		expect(await appRepository.isUpdated()).toBe(false)

		// Update again
		await appRepository.update()
		const postUpdateCommit = await appRepository.getCurrentCommit()

		// Check we're on the new commit
		expect(originalCommit).not.toBe(postUpdateCommit)
	})

	test('does not update when both repos are the same', async () => {
		const dataDirectory = await directory.create()
		const umbreld = new Umbreld({dataDirectory})
		const appRepository = new AppRepository(umbreld, gitServer.url)

		// Initial install
		await appRepository.update()
		const originalCommit = await appRepository.getCurrentCommit()
		expect(originalCommit).toBeTruthy()

		// Check we are updated
		expect(await appRepository.isUpdated()).toBe(true)

		// Update again
		await appRepository.update()
		const postUpdateCommit = await appRepository.getCurrentCommit()

		// Check we're on the same commit
		expect(originalCommit).toBe(postUpdateCommit)
	})
})

describe('appRepository.atomicClone()', () => {
	test('removes its temporary clone and preserves the installed repository when promotion fails', async () => {
		const dataDirectory = await directory.create()
		const appRepository = new AppRepository(new Umbreld({dataDirectory}), gitServer.url)
		const originalMarker = `${appRepository.path}/original-marker`
		const moveError = new Error('Simulated promotion failure')

		await fse.outputFile(originalMarker, 'original')

		const move = vi.spyOn(fse, 'move').mockImplementationOnce(async (source: string, destination: string) => {
			expect(destination).toBe(appRepository.path)
			await expect(fse.pathExists(`${source}/.git`)).resolves.toBe(true)
			await expect(fse.pathExists(`${source}/umbrel-app-store.yml`)).resolves.toBe(true)
			throw moveError
		})

		try {
			await expect(appRepository.atomicClone()).rejects.toBe(moveError)
		} finally {
			move.mockRestore()
		}

		await expect(fse.readdir(`${dataDirectory}/app-stores/.tmp`)).resolves.toEqual([])
		await expect(fse.readFile(originalMarker, 'utf8')).resolves.toBe('original')
		await expect(fse.readdir(appRepository.path)).resolves.toEqual(['original-marker'])
	})

	test('does not mask a promotion failure when temporary cleanup also fails', async () => {
		const dataDirectory = await directory.create()
		const appRepository = new AppRepository(new Umbreld({dataDirectory}), gitServer.url)
		const moveError = new Error('Simulated promotion failure')
		const cleanupError = new Error('Simulated cleanup failure')
		const move = vi.spyOn(fse, 'move').mockRejectedValueOnce(moveError)
		const remove = vi.spyOn(fse, 'remove').mockRejectedValueOnce(cleanupError)
		const logError = vi.spyOn(appRepository.logger, 'error').mockImplementation(() => {})

		try {
			await expect(appRepository.atomicClone()).rejects.toBe(moveError)
			expect(logError).toHaveBeenCalledWith(expect.stringContaining(`${dataDirectory}/app-stores/.tmp/`), cleanupError)
		} finally {
			move.mockRestore()
			remove.mockRestore()
			logError.mockRestore()
			await fse.remove(`${dataDirectory}/app-stores/.tmp`)
		}
	})
})

describe('appRepository.readRegistry()', () => {
	test('reads community registry', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'http://github.com/getumbrel/umbrel-apps.git')

		// Forcefully set app repo path to the community repo fixture
		appRepo.path = `${currentDirectory}/../test-utilities/fixtures/community-repo`
		umbreld.appStore.defaultAppStoreRepo = appRepo.path

		// Read registry
		const registry = await appRepo.readRegistry()
		const expectedRegistry = {
			url: 'http://github.com/getumbrel/umbrel-apps.git',
			meta: {
				id: 'sparkles',
				name: 'Sparkles',
			},
			apps: [
				{
					appStoreId: 'sparkles',
					manifestVersion: '1.0.0',
					id: 'sparkles-hello-world',
					name: 'Hello World',
					tagline: "Replace this tagline with your app's tagline",
					icon: 'https://svgur.com/i/mvA.svg',
					category: 'Development',
					version: '1.0.0',
					port: 4000,
					description: "Add your app's description here.\n\nYou can also add newlines!",
					developer: 'Umbrel',
					website: 'https://umbrel.com',
					submitter: 'Umbrel',
					submission: 'https://github.com/getumbrel/umbrel-hello-world-app',
					repo: 'https://github.com/getumbrel/umbrel-hello-world-app',
					support: 'https://github.com/getumbrel/umbrel-hello-world-app/issues',
					gallery: [
						'https://i.imgur.com/yyVG0Jb.jpeg',
						'https://i.imgur.com/yyVG0Jb.jpeg',
						'https://i.imgur.com/yyVG0Jb.jpeg',
					],
					releaseNotes: "Add what's new in the latest version of your app here.",
					dependencies: [],
					path: '',
					defaultUsername: '',
					defaultPassword: '',
					backupIgnore: ['data', 'logs', 'cache'],
				},
			],
		}
		expect(registry).toStrictEqual(expectedRegistry)
	})
})
