import {parentPort, threadId, workerData} from 'node:worker_threads'

import FileIndexEngine, {type FileIndexRoot, type WatcherChange} from './file-index-engine.js'
import {
	isFileIndexRoot,
	serializeError,
	type FileIndexNotificationMethod,
	type FileIndexRequestMethod,
	type FileIndexWorkerData,
	type FileIndexWorkerInboundMessage,
	type FileIndexWorkerOutboundMessage,
} from './file-index-worker-protocol.js'

if (!parentPort) throw new Error('File index worker requires a parent port')

const port = parentPort
const options = workerData as FileIndexWorkerData
const post = (message: FileIndexWorkerOutboundMessage) => port.postMessage(message)
const logger = {
	log: (message = '') => post({type: 'log', level: 'log', message}),
	verbose: (message: string) => post({type: 'log', level: 'verbose', message}),
	error: (message: string, error?: unknown) =>
		post({type: 'log', level: 'error', message, ...(error === undefined ? {} : {error: serializeError(error)})}),
}
const isHidden = (name: string) =>
	options.hiddenFiles.includes(name) || options.hiddenExtensions.some((extension) => name.endsWith(extension))

const index = new FileIndexEngine({
	dataDirectory: options.dataDirectory,
	logger,
	isHidden,
	onAvailabilityChange: (available) => post({type: 'availability', available}),
	reconciliationIntervalMs: options.reconciliationIntervalMs,
	recoveryRetryMs: options.recoveryRetryMs,
	watcherBulkThreshold: options.watcherBulkThreshold,
	batchSize: options.batchSize,
})

function rootsArg(args: unknown[]) {
	const roots = args[0]
	if (!Array.isArray(roots) || !roots.every(isFileIndexRoot)) throw new TypeError('Expected file index roots')
	return roots
}

function rootArg(args: unknown[], index = 0): FileIndexRoot {
	const root = args[index]
	if (!isFileIndexRoot(root)) throw new TypeError('Expected file index root')
	return root
}

function stringArg(args: unknown[], index = 0) {
	const value = args[index]
	if (typeof value !== 'string') throw new TypeError(`Expected string argument ${index}`)
	return value
}

function numberArg(args: unknown[], index = 0) {
	const value = args[index]
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Expected number argument ${index}`)
	return value
}

function watcherChangesArg(args: unknown[], index = 1): WatcherChange[] {
	const changes = args[index]
	if (
		!Array.isArray(changes) ||
		!changes.every((change) => {
			if (!change || typeof change !== 'object') return false
			const candidate = change as Partial<WatcherChange>
			return typeof candidate.path === 'string' && ['create', 'update', 'delete'].includes(candidate.type ?? '')
		})
	) {
		throw new TypeError('Expected watcher changes')
	}
	return changes as WatcherChange[]
}

async function request(method: FileIndexRequestMethod, args: unknown[]) {
	switch (method) {
		case 'start':
			return index.start()
		case 'stop':
			return index.stop()
		case 'setRoots':
			return index.setRoots(rootsArg(args))
		case 'addRoot':
			return index.addRoot(rootArg(args))
		case 'removeRoot':
			return index.removeRoot(stringArg(args))
		case 'reconcileAll':
			return index.reconcileAll(stringArg(args))
		case 'reconcileRoot':
			return index.reconcileRoot(stringArg(args), stringArg(args, 1))
		case 'reconcilePath':
			return index.reconcilePath(stringArg(args))
		case 'removePath':
			return index.removePath(stringArg(args))
		case 'movePath':
			return index.movePath(stringArg(args), stringArg(args, 1))
		case 'getEntryByVirtualPath':
			return index.getEntryByVirtualPath(stringArg(args))
		case 'getEntryBySystemPath':
			return index.getEntryBySystemPath(stringArg(args))
		case 'ensureThumbnail':
			return index.ensureThumbnail(stringArg(args))
		case 'getExistingThumbnail':
			return index.getExistingThumbnail(stringArg(args))
		case 'matchesThumbnail':
			return index.matchesThumbnail(stringArg(args), stringArg(args, 1), stringArg(args, 2), stringArg(args, 3))
		case 'searchCandidates':
			return index.searchCandidates(stringArg(args), stringArg(args, 1), numberArg(args, 2))
		case 'status':
			return index.status()
	}
}

function notification(method: FileIndexNotificationMethod, args: unknown[]) {
	switch (method) {
		case 'noteWatcherChanges': {
			index.noteWatcherChanges(stringArg(args), watcherChangesArg(args))
			return
		}
		case 'noteWatcherBurst':
			index.noteWatcherBurst(stringArg(args))
			return
		case 'startBackgroundReconciliation':
			index.startBackgroundReconciliation()
			return
		case 'scheduleFullReconciliation':
			index.scheduleFullReconciliation(stringArg(args))
	}
}

port.on('message', (message: FileIndexWorkerInboundMessage) => {
	if (message.type === 'notification') {
		try {
			notification(message.method, message.args)
		} catch (error) {
			logger.error(`Rejected file index notification '${message.method}'`, error)
		}
		return
	}

	void request(message.method, message.args).then(
		(result) => post({type: 'response', id: message.id, result}),
		(error) => post({type: 'response', id: message.id, error: serializeError(error)}),
	)
})

post({type: 'ready', threadId})
