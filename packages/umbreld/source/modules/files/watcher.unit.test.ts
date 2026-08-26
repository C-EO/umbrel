import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import type {FileChangeEvent} from './watcher.js'

const mocks = vi.hoisted(() => {
	const command = vi.fn(() => Promise.resolve({stdout: ''}))
	return {
		command,
		execaDollar: vi.fn((first: unknown) => (Array.isArray(first) ? command() : command)),
		subscribe: vi.fn(),
	}
})

vi.mock('execa', () => ({$: mocks.execaDollar}))
vi.mock('@parcel/watcher', () => ({default: {subscribe: mocks.subscribe}}))

import Watcher from './watcher.js'

const cleanups: Array<() => Promise<void>> = []

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

test('watcher health does not fail behind a busy consumer queue', async () => {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'watcher-unit-'))
	cleanups.push(() => rm(root, {recursive: true, force: true}))
	const home = nodePath.join(root, 'home')
	await fse.ensureDir(home)

	const callbacks: Array<(error: Error | null, events: FileChangeEvent[]) => void> = []
	const unsubscribe = vi.fn(async () => {})
	mocks.subscribe.mockImplementation(async (_path, callback) => {
		callbacks.push(callback)
		return {unsubscribe}
	})

	const neverSettles = new Promise<void>(() => {})
	const emitFileChanges = vi.fn(() => neverSettles)
	const logger = {error: vi.fn(), log: vi.fn(), verbose: vi.fn()}
	const umbreld = {
		eventBus: {emitFileChanges},
		files: {
			virtualToSystemPath: vi.fn(async () => home),
			virtualToSystemPathUnsafe: vi.fn(() => home),
		},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld
	const filesWatcher = new Watcher(umbreld, {paths: ['/Home']})

	await filesWatcher.start()
	const sentinelPath = nodePath.join(home, '.umbrel-watcher-health-check')
	await vi.waitFor(async () => expect(await fse.pathExists(sentinelPath)).toBe(true))

	// Occupy the single dispatch queue worker indefinitely, then deliver the
	// sentinel in a later native callback. Health checks should observe the raw
	// callback rather than waiting behind consumer work.
	callbacks[0](null, [{type: 'create', path: nodePath.join(home, 'busy-file')}])
	await vi.waitFor(() => expect(emitFileChanges).toHaveBeenCalledOnce())
	callbacks[0](null, [{type: 'create', path: sentinelPath}])

	await vi.waitFor(() => expect(logger.verbose).toHaveBeenCalledWith('Health check passed'))
	expect(mocks.subscribe).toHaveBeenCalledOnce()
	expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('Health check failed'))

	await filesWatcher.stop()
	expect(unsubscribe).toHaveBeenCalledOnce()
})
