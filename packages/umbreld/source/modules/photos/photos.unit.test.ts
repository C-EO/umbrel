import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import Photos from './photos.js'

test('keeps the complete durable deletion set when a later file operation fails', async () => {
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const trash = vi.fn(async (path: string) => {
		if (path.endsWith('second.jpg')) throw new Error('injected trash failure')
	})
	const photosDeleteItems = vi.fn(async () => 1)
	const emit = vi.fn()
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {
			trash,
			recoverTrashClaim: vi.fn(async () => false),
			fileIndex: {
				photosResolveDeletedItems: async () => [
					{id: 'first', path: '/Home/first.jpg', revision},
					{id: 'second', path: '/Home/second.jpg', revision},
				],
				photosDeleteItems,
			},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice')).rejects.toThrow('injected trash failure')
	expect(photosDeleteItems).not.toHaveBeenCalled()
	expect(trash).toHaveBeenNthCalledWith(1, '/Home/first.jpg', 'Alice', revision)
	expect(emit).not.toHaveBeenCalled()
})

test('permanently deletes every resolved copy of one logical content hash', async () => {
	const hash = 'ab'.repeat(32)
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const trash = vi.fn()
	const photosDeleteItems = vi.fn(async () => 1)
	const emit = vi.fn()
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {
			trash,
			recoverTrashClaim: vi.fn(async () => false),
			fileIndex: {
				photosResolveDeletedItems: async () => [
					{id: hash, path: '/Home/A/photo.jpg', revision},
					{id: hash, path: '/Home/B/copy.jpg', revision},
				],
				photosDeleteItems,
			},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice', [hash])).resolves.toBe(1)
	expect(trash).toHaveBeenNthCalledWith(1, '/Home/A/photo.jpg', 'Alice', revision)
	expect(trash).toHaveBeenNthCalledWith(2, '/Home/B/copy.jpg', 'Alice', revision)
	expect(photosDeleteItems).toHaveBeenCalledWith('Alice', [hash], false)
	expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['Alice']})
})

test('finishes a permanent deletion whose file was moved by an earlier attempt', async () => {
	const trash = vi.fn()
	const recoverTrashClaim = vi.fn(async () => false)
	const photosDeleteItems = vi.fn(async () => 1)
	const emit = vi.fn()
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {
			trash,
			recoverTrashClaim,
			fileIndex: {
				photosResolveDeletedItems: async () => [{id: 'already-moved', path: '/Home/already-moved.jpg'}],
				photosDeleteItems,
			},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice', ['already-moved'])).resolves.toBe(1)
	expect(trash).not.toHaveBeenCalled()
	expect(recoverTrashClaim).toHaveBeenCalledWith('/Home/already-moved.jpg', 'Alice')
	expect(photosDeleteItems).toHaveBeenCalledWith('Alice', ['already-moved'], false)
	expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['Alice']})
})

test('only recovers a remembered target that is no longer present in the live index', async () => {
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const trash = vi.fn()
	const recoverTrashClaim = vi.fn(async () => false)
	const photosDeleteItems = vi.fn(async () => 1)
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit: vi.fn()},
		files: {
			trash,
			recoverTrashClaim,
			fileIndex: {
				photosResolveDeletedItems: async () => [
					{id: 'remembered', path: '/Home/remembered.jpg', revision, recoverOnly: true},
				],
				photosDeleteItems,
			},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice', ['remembered'])).resolves.toBe(1)
	expect(recoverTrashClaim).toHaveBeenCalledWith('/Home/remembered.jpg', 'Alice')
	expect(trash).not.toHaveBeenCalled()
	expect(photosDeleteItems).toHaveBeenCalledWith('Alice', ['remembered'], false)
})

test('keeps durable Photos rows after recovering an interrupted filesystem claim', async () => {
	const photosDeleteItems = vi.fn(async () => 1)
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit: vi.fn()},
		files: {
			trash: vi.fn(),
			recoverTrashClaim: vi.fn(async () => true),
			fileIndex: {
				photosResolveDeletedItems: async () => [{id: 'interrupted', path: '/Home/interrupted.jpg'}],
				photosDeleteItems,
			},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice', ['interrupted'])).rejects.toThrow('[trash-claim-recovered]')
	expect(photosDeleteItems).not.toHaveBeenCalled()
})

test('keeps durable Photos rows while a recovered file is being rehashed', async () => {
	const trash = vi.fn()
	const recoverTrashClaim = vi.fn()
	const photosDeleteItems = vi.fn()
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit: vi.fn()},
		files: {
			trash,
			recoverTrashClaim,
			fileIndex: {
				photosResolveDeletedItems: async () => [{id: 'rehashing', path: '/Home/rehashing.jpg', pendingRevision: true}],
				photosDeleteItems,
			},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice', ['rehashing'])).rejects.toThrow('[photos-item-busy]')
	expect(trash).not.toHaveBeenCalled()
	expect(recoverTrashClaim).not.toHaveBeenCalled()
	expect(photosDeleteItems).not.toHaveBeenCalled()
})

test('uses a short-lived account-bound ticket for large download selections', async () => {
	const ids = Array.from({length: 500}, (_, index) => `item-${index}`)
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		files: {
			fileIndex: {
				photosResolveItems: async (accountId: string, requested: string[]) =>
					accountId === 'Alice' ? requested.map((id) => ({id, path: `/Users/Alice/${id}.jpg`})) : [],
			},
		},
	} as unknown as Umbreld
	const photos = new Photos(umbreld)

	const ticket = await photos.createDownloadTicket('Alice', ids)
	expect(ticket.length).toBeLessThan(100)
	expect(photos.consumeDownloadTicket('Bob', ticket)).toBeUndefined()

	const secondTicket = await photos.createDownloadTicket('Alice', ids)
	expect(photos.consumeDownloadTicket('Alice', secondTicket)).toStrictEqual(ids)
	expect(photos.consumeDownloadTicket('Alice', secondTicket)).toBeUndefined()
})

test('publishes the updated indexing snapshot when a source scope changes', async () => {
	const scope = {mode: 'everything-except' as const, paths: ['/Home/Corrupt.jpg']}
	const source = {id: 'home', scope}
	const state = {phase: 'ready', completed: 3, total: 3, percentage: 100} as const
	const emit = vi.fn(async () => {})
	const photosUpdateSource = vi.fn(async () => source)
	const photosIndexingState = vi.fn(async () => state)
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {fileIndex: {photosUpdateSource, photosIndexingState}},
	} as unknown as Umbreld
	const photos = new Photos(umbreld)

	await expect(photos.updateSource('Alice', 'home', scope)).resolves.toBe(source)
	expect(photosIndexingState).toHaveBeenCalledWith('Alice')
	expect(emit).toHaveBeenNthCalledWith(1, 'photos:change', {accountIds: ['Alice']})
	expect(emit).toHaveBeenNthCalledWith(2, 'photos:indexing-progress', {accountId: 'Alice', state})
})

test('keeps a completed source update successful when its progress snapshot is unavailable', async () => {
	const source = {id: 'home'}
	const error = vi.fn()
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn(), error})},
		eventBus: {emit: vi.fn()},
		files: {
			fileIndex: {
				photosUpdateSource: vi.fn(async () => source),
				photosIndexingState: vi.fn(async () => {
					throw new Error('file index is recovering')
				}),
			},
		},
	} as unknown as Umbreld
	const photos = new Photos(umbreld)

	await expect(photos.updateSource('Alice', 'home')).resolves.toBe(source)
	expect(error).toHaveBeenCalledWith(
		'Failed to report Photos indexing progress',
		expect.objectContaining({message: 'file index is recovering'}),
	)
})
