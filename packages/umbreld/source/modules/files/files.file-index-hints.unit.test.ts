import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import Files from './files.js'

const temporary = temporaryDirectory()

beforeAll(temporary.createRoot)
afterAll(temporary.destroyRoot)

function filesFixture(systemPath: string) {
	const error = vi.fn()
	const mcp = {removeFileGrantsWithin: vi.fn(async () => {})}
	const memberShares = {removeWithin: vi.fn(async () => {})}
	const files = new Files({
		dataDirectory: nodePath.dirname(systemPath),
		logger: {createChildLogger: () => ({error})},
		eventBus: {emit: vi.fn()},
		mcp,
	} as unknown as Umbreld)
	Object.assign(files, {
		virtualToSystemPath: vi.fn(async () => systemPath),
		getAllowedOperations: vi.fn(async () => ['writable', 'delete']),
		isCloudPathOverlap: vi.fn(() => false),
		chownSystemPath: vi.fn(async () => {}),
		memberShares,
		cloud: {resolveSharedDestinationDeletesAsOwner: vi.fn(async () => new Map())},
	})
	return {files, error, mcp, memberShares}
}

test('a successful create posts its index hint without waiting for it', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'created')
	const {files} = filesFixture(systemPath)
	let releaseIndexHint!: () => void
	const indexHintReleased = new Promise<void>((resolve) => (releaseIndexHint = resolve))
	const reconcilePath = vi.fn(() => indexHintReleased)
	Object.assign(files, {fileIndex: {reconcilePath}})

	await expect(files.createDirectory('/Home/created')).resolves.toMatchObject({created: true})

	expect(reconcilePath).toHaveBeenCalledWith(systemPath)
	expect(await fse.pathExists(systemPath)).toBe(true)
	releaseIndexHint()
})

test('an index failure never changes a successful filesystem result', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'deleted.txt')
	await fse.writeFile(systemPath, 'content')
	const {files, error} = filesFixture(systemPath)
	const removePath = vi.fn(async () => {
		throw new Error('index unavailable')
	})
	Object.assign(files, {fileIndex: {removePath}})

	await expect(files.delete('/Home/deleted.txt')).resolves.toStrictEqual(true)

	expect(removePath).toHaveBeenCalledWith(systemPath)
	expect(await fse.pathExists(systemPath)).toBe(false)
	await vi.waitFor(() =>
		expect(error).toHaveBeenCalledWith(`Failed to update file index after delete '${systemPath}'`, expect.any(Error)),
	)
})

test('returns after access cleanup without waiting for the delete index hint', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'deleted.txt')
	await fse.writeFile(systemPath, 'content')
	const {files, mcp, memberShares} = filesFixture(systemPath)
	let releaseIndexHint!: () => void
	const indexHintReleased = new Promise<void>((resolve) => (releaseIndexHint = resolve))
	const removePath = vi.fn(() => indexHintReleased)
	Object.assign(files, {fileIndex: {removePath}})

	let deletionFinished = false
	const deletion = files.delete('/Home/deleted.txt').then((result) => {
		deletionFinished = true
		return result
	})
	await vi.waitFor(() => expect(removePath).toHaveBeenCalledWith(systemPath))

	expect(await fse.pathExists(systemPath)).toBe(false)
	expect(memberShares.removeWithin).toHaveBeenCalledWith('/Home/deleted.txt')
	expect(mcp.removeFileGrantsWithin).toHaveBeenCalledWith('/Home/deleted.txt')
	expect(deletionFinished).toBe(true)
	await expect(deletion).resolves.toBe(true)

	releaseIndexHint()
})

test('registers the same physical member roots with Watcher and FileIndex', async () => {
	const dataDirectory = await temporary.create()
	const error = vi.fn()
	const files = new Files({
		dataDirectory,
		logger: {createChildLogger: () => ({error})},
		eventBus: {emit: vi.fn()},
	} as unknown as Umbreld)
	const addPath = vi.fn(async () => {})
	const addRoot = vi.fn(async () => {})
	Object.assign(files, {
		watcher: {addPath},
		fileIndex: {addRoot},
		chownSystemPath: vi.fn(async () => {}),
	})

	await files.createMemberDirectories('alice')

	expect(addPath.mock.calls).toStrictEqual([[`/Users/alice`], [`/Users/alice/Trash`]])
	expect(addRoot.mock.calls).toStrictEqual([
		[
			{
				virtualPath: '/Users/alice',
				systemPath: nodePath.join(dataDirectory, 'members/alice/home'),
				ownerId: 'alice',
				kind: 'home',
				searchEnabled: true,
			},
		],
		[
			{
				virtualPath: '/Users/alice/Trash',
				systemPath: nodePath.join(dataDirectory, 'members/alice/trash'),
				ownerId: 'alice',
				kind: 'trash',
				searchEnabled: false,
			},
		],
	])
})
