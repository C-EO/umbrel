import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import Thumbnails, {MAX_BACKGROUND_THUMBNAIL_WORK} from './thumbnails.js'
import type {FileChangeEvent} from './watcher.js'

const convert = vi.hoisted(() => vi.fn(async () => ({stdout: ''})))
vi.mock('execa', () => ({$: convert}))

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function createThumbnails() {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'thumbnails-unit-'))
	cleanups.push(() => rm(root, {recursive: true, force: true}))
	let fileListener!: (event: FileChangeEvent) => Promise<void>
	const logger = {error: vi.fn(), log: vi.fn(), verbose: vi.fn()}
	const thumbnails = new Thumbnails({
		dataDirectory: root,
		eventBus: {
			on: vi.fn((event: string, listener: (event: FileChangeEvent) => Promise<void>) => {
				if (event === 'files:watcher:change') fileListener = listener
				return () => {}
			}),
		},
		files: {
			systemToVirtualPath: vi.fn((path: string) => path),
			virtualToSystemPath: vi.fn(async (path: string) => path),
		},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld)
	await thumbnails.start()
	return {fileListener, logger, thumbnails}
}

test('delete events never stat supported thumbnail paths', async () => {
	const {fileListener, thumbnails} = await createThumbnails()
	const stat = vi.spyOn(fse, 'stat')

	await fileListener({type: 'delete', path: '/tmp/deleted.jpg'})

	expect(stat).not.toHaveBeenCalledWith('/tmp/deleted.jpg')
	await thumbnails.stop()
})

test('bounds watcher-triggered work without affecting on-demand thumbnails', async () => {
	const {fileListener, logger, thumbnails} = await createThumbnails()
	vi.useFakeTimers()
	vi.spyOn(fse, 'stat').mockResolvedValue({isFile: () => true} as never)
	const eventCount = MAX_BACKGROUND_THUMBNAIL_WORK + 250

	await Promise.all(
		Array.from({length: eventCount}, (_, index) =>
			fileListener({type: 'create', path: `/tmp/background-${index}.jpg`}),
		),
	)

	expect(logger.verbose).toHaveBeenCalledTimes(MAX_BACKGROUND_THUMBNAIL_WORK)
	vi.spyOn(thumbnails, 'getThumbnailHash').mockResolvedValue('a'.repeat(64))
	await expect(thumbnails.getThumbnailOnDemand('/tmp/background-overflow.jpg')).resolves.toContain(
		`/api/files/thumbnail/${'a'.repeat(64)}.webp`,
	)
	expect(convert).toHaveBeenCalledOnce()
	await thumbnails.stop()
})
