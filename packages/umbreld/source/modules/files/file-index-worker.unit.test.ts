import {EventEmitter} from 'node:events'
import nodePath from 'node:path'
import {writeFile} from 'node:fs/promises'
import type {Worker} from 'node:worker_threads'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'
import pRetry from 'p-retry'
import {afterEach, expect, test, vi} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.js'
import FileIndex, {type FileIndexRoot} from './file-index.js'
import type {FileIndexWorkerInboundMessage, FileIndexWorkerOutboundMessage} from './file-index-worker-protocol.js'

const temporary = temporaryDirectory()
const indexes: FileIndex[] = []
const logger = {log: vi.fn(), verbose: vi.fn(), error: vi.fn()}

afterEach(async () => {
	await Promise.all(indexes.splice(0).map((index) => index.stop()))
	await temporary.destroyRoot()
	vi.clearAllMocks()
})

async function fixture() {
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(dataDirectory, 'home')
	await fse.ensureDir(homeDirectory)
	const root: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: homeDirectory,
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	const index = new FileIndex({
		dataDirectory,
		logger,
		hiddenFiles: ['.hidden'],
		hiddenExtensions: ['.umbrel-upload'],
	})
	indexes.push(index)
	await index.setRoots([root])
	return {dataDirectory, homeDirectory, index, root}
}

test('owns crawling, SQLite, and search in a dedicated worker', async () => {
	const {homeDirectory, index} = await fixture()
	await writeFile(nodePath.join(homeDirectory, 'worker-result.txt'), 'visible')
	await writeFile(nodePath.join(homeDirectory, '.hidden'), 'hidden')

	await index.start()
	await index.reconcileRoot('/Home', 'test')

	expect(index.available).toBe(true)
	expect(index.workerThreadId).toBeGreaterThan(0)
	await expect(index.getEntryByVirtualPath('/Home/worker-result.txt')).resolves.toMatchObject({
		name: 'worker-result.txt',
		size: 7,
	})
	await expect(index.searchCandidates('/Home', 'worker-result', 10)).resolves.toEqual([
		expect.objectContaining({name: 'worker-result.txt'}),
	])
	await expect(index.searchCandidates('/Home', 'hidden', 10)).resolves.toStrictEqual([])
	await expect(index.status()).resolves.toMatchObject({
		available: true,
		entryCount: 2,
		workerThreadId: index.workerThreadId,
	})
})

test('keeps the main event loop responsive during CPU-heavy fuzzy searches', async () => {
	const {dataDirectory, index, root} = await fixture()
	await index.start()
	await index.stop()
	indexes.splice(indexes.indexOf(index), 1)

	const database = new BetterSqlite3(index.databasePath)
	const rootId = (database.prepare("SELECT id FROM index_roots WHERE virtual_path = '/Home'").get() as {id: number}).id
	database
		.prepare(
			`WITH RECURSIVE sequence(value) AS (
				VALUES(1)
				UNION ALL SELECT value + 1 FROM sequence WHERE value < 100000
			)
			INSERT INTO entries(root_id, relative_path, name, search_name, type, size, modified_ms, hidden)
			SELECT ?, printf('bulk/%06d.txt', value), printf('worker-isolation-%06d.txt', value),
				printf('worker-isolation-%06d.txt', value), 'file', 1, 1, 0
			FROM sequence`,
		)
		.run(rootId)
	database.close()

	const reopened = new FileIndex({
		dataDirectory,
		logger,
		hiddenFiles: [],
		hiddenExtensions: [],
	})
	indexes.push(reopened)
	await reopened.setRoots([root])
	await reopened.start()

	let heartbeats = 0
	const heartbeat = setInterval(() => heartbeats++, 1)
	try {
		await Promise.all(
			Array.from({length: 4}, (_, index) => reopened.searchCandidates('/Home', `worker-isolation-${index}`, 10)),
		)
	} finally {
		clearInterval(heartbeat)
	}

	// One timer tick is enough to prove the searches did not monopolize the main
	// thread. Requiring an arbitrary number makes the assertion fail when the
	// indexed query becomes faster, especially under CI coverage instrumentation.
	expect(heartbeats).toBeGreaterThan(0)
})

class FakeWorker extends EventEmitter {
	readonly messages: FileIndexWorkerInboundMessage[] = []
	readonly threadId: number
	#heldMethods = new Set<string>()

	constructor(threadId: number) {
		super()
		this.threadId = threadId
		queueMicrotask(() => this.emitMessage({type: 'ready', threadId}))
	}

	hold(method: string) {
		this.#heldMethods.add(method)
	}

	postMessage(message: FileIndexWorkerInboundMessage) {
		this.messages.push(message)
		if (message.type !== 'request' || this.#heldMethods.has(message.method)) return
		queueMicrotask(() => {
			if (message.method === 'start') this.emitMessage({type: 'availability', available: true})
			this.emitMessage({
				type: 'response',
				id: message.id,
				result: message.method === 'searchCandidates' ? [] : undefined,
			})
		})
	}

	crash() {
		this.emit('exit', 1)
	}

	async terminate() {
		this.emit('exit', 0)
		return 0
	}

	private emitMessage(message: FileIndexWorkerOutboundMessage) {
		this.emit('message', message)
	}
}

test('compacts watcher bursts and restores state after an unexpected worker exit', async () => {
	const dataDirectory = await temporary.create()
	const workers: FakeWorker[] = []
	const createWorker = () => {
		const worker = new FakeWorker(workers.length + 1)
		workers.push(worker)
		return worker as unknown as Worker
	}
	const root: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: nodePath.join(dataDirectory, 'home'),
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: [], watcherBulkThreshold: 250},
		{createWorker, workerRestartDelayMs: 1},
	)
	indexes.push(index)
	await index.setRoots([root])
	index.startBackgroundReconciliation()
	await index.start()

	workers[0].messages.length = 0
	index.noteWatcherChanges(
		'/Home',
		Array.from({length: 249}, (_, index) => ({path: `${root.systemPath}/${index}`, type: 'create' as const})),
	)
	index.noteWatcherChanges(
		'/Home',
		Array.from({length: 250}, (_, index) => ({path: `${root.systemPath}/bulk-${index}`, type: 'create' as const})),
	)
	expect(workers[0].messages).toStrictEqual([
		{
			type: 'notification',
			method: 'noteWatcherChanges',
			args: ['/Home', Array.from({length: 249}, (_, index) => ({path: `${root.systemPath}/${index}`, type: 'create'}))],
		},
		{type: 'notification', method: 'noteWatcherBurst', args: ['/Home']},
	])

	workers[0].hold('searchCandidates')
	const interruptedSearch = index.searchCandidates('/Home', 'pending', 10)
	workers[0].crash()
	await expect(interruptedSearch).rejects.toThrow('exited with code 1')
	await pRetry(
		async () => {
			expect(workers).toHaveLength(2)
			expect(index.available).toBe(true)
			expect(index.workerThreadId).toBe(2)
		},
		{retries: 20, factor: 1, minTimeout: 5, maxTimeout: 5},
	)
	expect(workers[1].messages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({type: 'request', method: 'setRoots', args: [[root]]}),
			expect.objectContaining({type: 'request', method: 'start'}),
			{type: 'notification', method: 'startBackgroundReconciliation', args: []},
		]),
	)
})

test('restarts when a live worker stalls during boot', async () => {
	const dataDirectory = await temporary.create()
	const workers: FakeWorker[] = []
	const createWorker = () => {
		const worker = new FakeWorker(workers.length + 1)
		if (workers.length === 0) worker.hold('setRoots')
		workers.push(worker)
		return worker as unknown as Worker
	}
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{createWorker, workerRestartDelayMs: 1, workerBootTimeoutMs: 5},
	)
	indexes.push(index)

	await index.start()
	await pRetry(
		async () => {
			expect(workers).toHaveLength(2)
			expect(index.available).toBe(true)
			expect(index.workerThreadId).toBe(2)
		},
		{retries: 20, factor: 1, minTimeout: 5, maxTimeout: 5},
	)
	expect(logger.error).toHaveBeenCalledWith('Failed to start file index worker', expect.any(Error))
})

test('stops without waiting for a worker stalled during boot', async () => {
	const dataDirectory = await temporary.create()
	const worker = new FakeWorker(1)
	worker.hold('setRoots')
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{createWorker: () => worker as unknown as Worker, workerBootTimeoutMs: 60_000},
	)
	indexes.push(index)

	const starting = index.start()
	await vi.waitFor(() => expect(worker.messages).toContainEqual(expect.objectContaining({method: 'setRoots'})))
	await expect(index.stop()).resolves.toBeUndefined()
	await expect(starting).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({available: false, workerThreadId: undefined})
})

test('forcibly terminates a worker that stalls during graceful shutdown', async () => {
	const dataDirectory = await temporary.create()
	const worker = new FakeWorker(1)
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{createWorker: () => worker as unknown as Worker, workerShutdownTimeoutMs: 5},
	)
	indexes.push(index)
	await index.start()
	worker.hold('stop')

	await expect(index.stop()).resolves.toBeUndefined()
	expect(logger.error).toHaveBeenCalledWith('Failed to stop file index worker cleanly', expect.any(Error))
	await expect(index.status()).resolves.toMatchObject({available: false, workerThreadId: undefined})
})
