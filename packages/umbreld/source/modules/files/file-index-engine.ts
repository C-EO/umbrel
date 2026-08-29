import nodePath from 'node:path'
import type {Stats} from 'node:fs'
import {opendir, lstat} from 'node:fs/promises'

import BetterSqlite3 from 'better-sqlite3'
import type DatabaseTypes from 'better-sqlite3'
import {fuzzy} from 'fast-fuzzy'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import {FILE_INDEX_SCHEMA_VERSION, foldSearchName, migrateFileIndex} from './file-index/migrations.js'

type Database = DatabaseTypes.Database

const DEFAULT_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_RECOVERY_RETRY_MS = 60 * 1000
const MAX_RECOVERY_RETRY_MS = 60 * 60 * 1000
export const DEFAULT_WATCHER_BULK_THRESHOLD = 250
const DEFAULT_BATCH_SIZE = 256
const MAX_LIVE_WORK_PER_SCAN_BATCH = 100
const SEARCH_MATCH_THRESHOLD = 0.66
const MAX_MATCHES_DURING_SEARCH = 10_000
const MIN_TRIGRAM_QUERY_LENGTH = 3
const MIN_FUZZY_TRIGRAM_QUERY_LENGTH = 6
const MIN_FTS_CANDIDATES = 1_000
const MAX_SHORT_QUERY_CANDIDATES = 1_000
const FTS_CANDIDATES_PER_RESULT = 4
const MAX_FTS_CANDIDATES = 10_000
const MAX_RARE_TRIGRAMS = 6

export type FileIndexLogger = {
	log(message?: string): void
	verbose(message: string): void
	error(message: string, error?: unknown): void
}

export type FileIndexRoot = {
	virtualPath: string
	systemPath: string
	ownerId: string
	kind: 'home' | 'trash' | 'apps' | 'machines'
	searchEnabled: boolean
}

type RootState = FileIndexRoot & {
	id?: number
	state: 'warming' | 'ready' | 'degraded'
	scanGeneration: number
	lastSuccessfulScanAt?: number
	lastError?: string
}

type EntryType = 'directory' | 'symbolic-link' | 'socket' | 'block-device' | 'character-device' | 'fifo' | 'file'

type EntryWrite = {
	rootId: number
	relativePath: string
	name: string
	type: EntryType
	size: number
	modifiedMs: number
	hidden: number
}

type PathMutation =
	| {type: 'write'; entries: EntryWrite[]; markSeen: boolean}
	| {type: 'delete'; rootId: number; relativePath: string}

export type IndexedEntry = Omit<EntryWrite, 'rootId' | 'hidden'> & {
	id: number
	rootId: number
	rootVirtualPath: string
	virtualPath: string
	systemPath: string
	hidden: boolean
}

export type SearchCandidate = {
	id: number
	name: string
	virtualPath: string
}

type WalkedEntry = {systemPath: string; stats: Stats}
type WalkPathError = (systemPath: string, error: unknown) => void
type WalkTree = (
	rootSystemPath: string,
	stopping: () => boolean,
	includePath?: (systemPath: string) => boolean,
	onPathError?: WalkPathError,
) => AsyncIterable<WalkedEntry>
export type WatcherChange = {path: string; type: 'create' | 'update' | 'delete'}
type DirectoryReconciliation = 'root' | 'entry'
type PathReconciliationResult = {completion?: Promise<void>}
type RootReconciliation = {requestedRoot: RootState; reason: string; rerun: boolean; promise: Promise<void>}
type ActiveRootSnapshot = {root: RootState; rerunRequested: boolean}
type PendingLiveWork = {
	operation: () => Promise<void>
	priority: number
	cost: number
	sequence: number
	resolve: () => void
	reject: (error: unknown) => void
}
type SearchRow = {id: number; name: string; relative_path: string}
type FtsVocabularyRow = {term: string; doc: number}

export type FileIndexEngineOptions = {
	dataDirectory: string
	logger: FileIndexLogger
	isHidden: (name: string) => boolean
	onAvailabilityChange?: (available: boolean) => void
	reconciliationIntervalMs?: number
	recoveryRetryMs?: number
	watcherBulkThreshold?: number
	batchSize?: number
	walkTree?: WalkTree
}

type RootRow = {
	id: number
	virtual_path: string
	system_path: string
	owner_id: string
	kind: FileIndexRoot['kind']
	search_enabled: number
	state: RootState['state']
	scan_generation: number
	last_successful_scan_at: number | null
	last_error: string | null
}

type EntryRow = {
	id: number
	root_id: number
	root_virtual_path: string
	root_system_path: string
	relative_path: string
	name: string
	search_name: string
	search_name_folded: string
	type: EntryType
	size: number
	modified_ms: number
	hidden: number
}

class ScanCancelledError extends Error {}
class UnsupportedFileIndexSchemaError extends Error {}

function isUnreadablePathError(error: unknown) {
	const code = (error as NodeJS.ErrnoException).code
	return code === 'EACCES' || code === 'EPERM' || code === 'EIO' || code === 'ESTALE'
}

function skipUnreadablePath(systemPath: string, rootSystemPath: string, error: unknown, onPathError?: WalkPathError) {
	if (systemPath === rootSystemPath || !onPathError || !isUnreadablePathError(error)) return false
	onPathError(systemPath, error)
	return true
}

export async function* walkFileTree(
	rootSystemPath: string,
	stopping: () => boolean,
	includePath: (systemPath: string) => boolean = () => true,
	onPathError?: WalkPathError,
): AsyncIterable<WalkedEntry> {
	const directories = [rootSystemPath]

	while (directories.length > 0) {
		if (stopping()) throw new ScanCancelledError('File index is stopping')
		const directory = directories.pop()!

		let handle
		try {
			handle = await opendir(directory)
		} catch (error) {
			if (directory !== rootSystemPath && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
			if (skipUnreadablePath(directory, rootSystemPath, error, onPathError)) continue
			throw error
		}

		try {
			for await (const directoryEntry of handle) {
				if (stopping()) throw new ScanCancelledError('File index is stopping')
				const systemPath = nodePath.join(directory, directoryEntry.name)
				if (!includePath(systemPath)) continue
				let stats: Stats
				try {
					stats = await lstat(systemPath)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
					if (skipUnreadablePath(systemPath, rootSystemPath, error, onPathError)) continue
					throw error
				}

				yield {systemPath, stats}
				if (stats.isDirectory()) directories.push(systemPath)
			}
		} catch (error) {
			if (error instanceof ScanCancelledError) throw error
			if (skipUnreadablePath(directory, rootSystemPath, error, onPathError)) continue
			throw error
		}
	}
}

function unreadableReconciliationError(root: RootState, unreadablePaths: Map<string, unknown>) {
	const examples = [...unreadablePaths].slice(0, 3).map(([relativePath, error]) => {
		const code = (error as NodeJS.ErrnoException).code
		const message = error instanceof Error ? error.message : String(error)
		return `'${joinVirtualPath(root.virtualPath, relativePath)}' (${code ? `${code}: ` : ''}${message})`
	})
	const omitted = unreadablePaths.size - examples.length
	const suffix = omitted > 0 ? `; ${omitted} more` : ''
	return new Error(
		`Skipped ${unreadablePaths.size} unreadable ${unreadablePaths.size === 1 ? 'path' : 'paths'}: ${examples.join(
			', ',
		)}${suffix}`,
	)
}

export default class FileIndexEngine {
	readonly databasePath: string
	readonly logger: FileIndexLogger

	#database?: Database
	#schemaVersion = 0
	#available = false
	#started = false
	#stopping = false
	#roots = new Map<string, RootState>()
	#rootScans = new Map<string, RootReconciliation>()
	#activeRootSnapshot?: ActiveRootSnapshot
	#pendingLiveWork: PendingLiveWork[] = []
	#nextLiveWorkSequence = 0
	#mutationQueue = new PQueue({concurrency: 1})
	#scanQueue = new PQueue({concurrency: 1})
	#reconciliationTimer?: ReturnType<typeof setTimeout>
	#recoveryTimer?: ReturnType<typeof setTimeout>
	#recoveryAttempt?: Promise<void>
	#recoveryAttempts = 0

	#isHidden: (name: string) => boolean
	#onAvailabilityChange?: (available: boolean) => void
	#reconciliationIntervalMs: number
	#recoveryRetryMs: number
	#watcherBulkThreshold: number
	#batchSize: number
	#walkTree: WalkTree

	constructor({
		dataDirectory,
		logger,
		isHidden,
		onAvailabilityChange,
		reconciliationIntervalMs = DEFAULT_RECONCILIATION_INTERVAL_MS,
		recoveryRetryMs = DEFAULT_RECOVERY_RETRY_MS,
		watcherBulkThreshold = DEFAULT_WATCHER_BULK_THRESHOLD,
		batchSize = DEFAULT_BATCH_SIZE,
		walkTree = walkFileTree,
	}: FileIndexEngineOptions) {
		this.databasePath = nodePath.join(dataDirectory, 'file-index', 'index.sqlite3')
		this.logger = logger
		this.#isHidden = isHidden
		this.#onAvailabilityChange = onAvailabilityChange
		this.#reconciliationIntervalMs = reconciliationIntervalMs
		this.#recoveryRetryMs = recoveryRetryMs
		this.#watcherBulkThreshold = watcherBulkThreshold
		this.#batchSize = batchSize
		this.#walkTree = walkTree
	}

	get available() {
		return this.#available
	}

	async start() {
		if (this.#started) return
		this.#started = true
		this.#stopping = false
		this.#recoveryAttempts = 0
		await this.#open().catch(async (error) => {
			await this.#handleOpenFailure(error)
		})
	}

	async #handleOpenFailure(error: unknown) {
		this.#closeDatabase()
		this.#database = undefined
		this.#setAvailable(false)
		this.logger.error('File index is unavailable', error)
		this.#scheduleRecovery()
	}

	#scheduleRecovery() {
		if (!this.#started || this.#stopping || this.#available || this.#recoveryTimer) return
		const delay = Math.min(this.#recoveryRetryMs * 2 ** this.#recoveryAttempts, MAX_RECOVERY_RETRY_MS)
		this.#recoveryAttempts++
		this.#recoveryTimer = setTimeout(() => {
			this.#recoveryTimer = undefined
			this.#recoveryAttempt = this.#recover().finally(() => {
				this.#recoveryAttempt = undefined
			})
		}, delay)
	}

	async #recover() {
		try {
			await this.#open()
			if (this.#stopping) return
			this.#recoveryAttempts = 0
			this.logger.log('Recovered file index database')
			void this.reconcileAll('database-recovered')
		} catch (error) {
			await this.#handleOpenFailure(error)
		}
	}

	async #open() {
		await fse.ensureDir(nodePath.dirname(this.databasePath))

		try {
			await this.#openAndMigrate()
		} catch (error) {
			const quarantineReason = databaseQuarantineReason(error)
			if (!quarantineReason) throw error
			this.#closeDatabase()
			this.#database = undefined
			await this.#quarantineDatabase(quarantineReason)
			await this.#openAndMigrate()
		}

		this.#setAvailable(true)
		this.logger.log(`Opened file index schema v${this.#schemaVersion}`)
		if (this.#roots.size > 0) await this.#syncRoots()
	}

	async #openAndMigrate() {
		this.#database = new BetterSqlite3(this.databasePath, {timeout: 5000})
		this.#database.pragma('journal_mode = WAL')
		this.#database.pragma('foreign_keys = ON')
		this.#schemaVersion = await migrateFileIndex(this.#database)
		if (this.#schemaVersion !== FILE_INDEX_SCHEMA_VERSION) {
			throw new UnsupportedFileIndexSchemaError(
				`Unsupported file index schema v${this.#schemaVersion}; expected v${FILE_INDEX_SCHEMA_VERSION}`,
			)
		}
		this.#database.exec(`
			CREATE TEMP TABLE reconciliation_seen (
				root_id INTEGER NOT NULL,
				relative_path TEXT NOT NULL,
				PRIMARY KEY(root_id, relative_path)
			) WITHOUT ROWID
		`)
	}

	#closeDatabase() {
		try {
			this.#database?.close()
		} catch {}
	}

	async #quarantineDatabase(reason = 'corrupt') {
		const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
		const quarantineBase = `${this.databasePath}.${reason}-${timestamp}`
		let quarantined = false

		for (const suffix of ['', '-wal', '-shm', '.wal']) {
			const source = `${this.databasePath}${suffix}`
			if (!(await fse.pathExists(source))) continue
			await fse.move(source, `${quarantineBase}${suffix}`)
			quarantined = true
		}

		if (quarantined) this.logger.error(`Quarantined ${reason} file index as '${nodePath.basename(quarantineBase)}'`)
	}

	async setRoots(roots: FileIndexRoot[]) {
		const previous = this.#roots
		const changedRoots: string[] = []
		this.#roots = new Map(
			roots.map((root) => {
				const existing = previous.get(root.virtualPath)
				if (existing && sameRootDefinition(existing, root)) return [root.virtualPath, existing]
				changedRoots.push(root.virtualPath)
				return [
					root.virtualPath,
					{
						...root,
						id: existing?.id,
						state: existing?.state ?? 'warming',
						scanGeneration: existing?.scanGeneration ?? 0,
						lastSuccessfulScanAt: existing?.lastSuccessfulScanAt,
						lastError: existing?.lastError,
					},
				]
			}),
		)
		for (const virtualPath of changedRoots) {
			const active = this.#rootScans.get(virtualPath)
			const replacement = this.#roots.get(virtualPath)
			if (!active || !replacement?.id) continue
			active.requestedRoot = replacement
			active.reason = 'roots-updated'
		}
		if (this.#available) await this.#syncRoots()
	}

	async addRoot(root: FileIndexRoot) {
		const existing = this.#roots.get(root.virtualPath)
		if (existing && sameRootDefinition(existing, root)) return
		const added: RootState = {
			...root,
			id: existing?.id,
			state: existing?.state ?? 'warming',
			scanGeneration: existing?.scanGeneration ?? 0,
			lastSuccessfulScanAt: existing?.lastSuccessfulScanAt,
			lastError: existing?.lastError,
		}
		this.#roots.set(root.virtualPath, added)
		if (this.#available) await this.#syncRoots()
		if (this.#started) void this.reconcileRoot(root.virtualPath, 'root-added')
	}

	async removeRoot(virtualPath: string) {
		this.#roots.delete(virtualPath)
		if (!this.#available) return
		await this.#mutate((database) => {
			const remove = database.transaction(() => {
				run(database, 'DELETE FROM index_roots WHERE virtual_path = ?', virtualPath)
				run(database, 'DELETE FROM reconciliation_seen WHERE root_id NOT IN (SELECT id FROM index_roots)')
			})
			remove.immediate()
		}, 10)
	}

	async #syncRoots() {
		const roots = [...this.#roots.values()]
		await this.#mutate((database) => {
			const sync = database.transaction(() => {
				const existingRows = all(database, 'SELECT virtual_path FROM index_roots') as Array<{
					virtual_path: string
				}>
				const desiredPaths = new Set(roots.map(({virtualPath}) => virtualPath))

				for (const row of existingRows) {
					if (!desiredPaths.has(row.virtual_path)) {
						run(database, 'DELETE FROM index_roots WHERE virtual_path = ?', row.virtual_path)
					}
				}

				const now = Date.now()
				for (const root of roots) {
					run(
						database,
						`INSERT INTO index_roots(
						virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(virtual_path) DO UPDATE SET
						system_path = excluded.system_path,
						owner_id = excluded.owner_id,
						kind = excluded.kind,
						search_enabled = excluded.search_enabled,
						updated_at = excluded.updated_at`,
						root.virtualPath,
						root.systemPath,
						root.ownerId,
						root.kind,
						Number(root.searchEnabled),
						now,
						now,
					)
				}
				run(database, 'DELETE FROM reconciliation_seen WHERE root_id NOT IN (SELECT id FROM index_roots)')
			})
			sync.immediate()
		}, 10)
		await this.#loadRootState()
	}

	async #loadRootState() {
		const rows = all(this.#requireDatabase(), 'SELECT * FROM index_roots') as RootRow[]
		for (const row of rows) {
			const registered = this.#roots.get(row.virtual_path)
			if (!registered) continue
			registered.id = Number(row.id)
			registered.state = row.state
			registered.scanGeneration = Number(row.scan_generation)
			registered.lastSuccessfulScanAt =
				row.last_successful_scan_at === null ? undefined : Number(row.last_successful_scan_at)
			registered.lastError = row.last_error ?? undefined
		}
	}

	startBackgroundReconciliation() {
		if (!this.#started || this.#stopping) return
		void this.reconcileAll('startup')
		this.#schedulePeriodicReconciliation()
	}

	scheduleFullReconciliation(reason: string) {
		if (!this.#started || this.#stopping) return
		void this.reconcileAll(reason)
	}

	async reconcileAll(reason: string) {
		if (!this.#available || this.#stopping) return
		const roots = [...this.#roots.values()].sort(
			(a, b) => Number(b.searchEnabled) - Number(a.searchEnabled) || a.virtualPath.localeCompare(b.virtualPath),
		)
		for (const root of roots) await this.reconcileRoot(root.virtualPath, reason)
	}

	#schedulePeriodicReconciliation() {
		if (this.#reconciliationTimer) clearTimeout(this.#reconciliationTimer)
		const jitter = Math.floor(this.#reconciliationIntervalMs * 0.05 * Math.random())
		this.#reconciliationTimer = setTimeout(async () => {
			await this.reconcileAll('periodic')
			if (!this.#stopping) this.#schedulePeriodicReconciliation()
		}, this.#reconciliationIntervalMs + jitter)
	}

	async reconcileRoot(virtualPath: string, reason: string): Promise<void> {
		if (!this.#available || this.#stopping) return
		const requestedRoot = this.#roots.get(virtualPath)
		if (!requestedRoot?.id) return
		const activeSnapshot = this.#activeRootSnapshot
		if (activeSnapshot?.root.virtualPath === virtualPath) activeSnapshot.rerunRequested = true
		const existing = this.#rootScans.get(virtualPath)
		if (existing) {
			existing.requestedRoot = requestedRoot
			existing.reason = reason
			existing.rerun = true
			return existing.promise
		}

		const reconciliation: RootReconciliation = {
			requestedRoot,
			reason,
			rerun: false,
			promise: Promise.resolve(),
		}
		reconciliation.promise = this.#runRootReconciliation(virtualPath, reconciliation).finally(() => {
			if (this.#rootScans.get(virtualPath) === reconciliation) this.#rootScans.delete(virtualPath)
		})
		this.#rootScans.set(virtualPath, reconciliation)
		return reconciliation.promise
	}

	async #runRootReconciliation(virtualPath: string, reconciliation: RootReconciliation) {
		while (!this.#stopping && this.#available) {
			const root = reconciliation.requestedRoot
			const reason = reconciliation.reason
			await (this.#scanQueue.add(async () => {
				if (this.#roots.get(virtualPath) !== root) {
					// A removed root cannot satisfy a queued rerun. Clear the flag so
					// this reconciliation exits instead of repeatedly queueing no-op work.
					reconciliation.rerun = false
					return
				}
				// Requests received while this pass was merely queued are covered by
				// the snapshot about to start. Only later requests require a rerun.
				reconciliation.rerun = false
				await this.#scanRootSnapshot(root, reason)
			}) as Promise<void>)
			if (reconciliation.requestedRoot === root && !reconciliation.rerun) return
		}
	}

	async #scanRootSnapshot(root: RootState, reason: string) {
		if (!root.id || this.#rootScanCancelled(root)) return
		if (this.#activeRootSnapshot) throw new Error('File index root snapshots cannot overlap')
		const activeSnapshot: ActiveRootSnapshot = {root, rerunRequested: false}
		this.#activeRootSnapshot = activeSnapshot

		const generation = root.scanGeneration + 1
		const startedAt = Date.now()
		let indexedEntries = 0
		const unreadablePaths = new Map<string, unknown>()
		this.logger.log(`Reconciling '${root.virtualPath}' (${reason})`)

		try {
			await this.#mutate((database) => {
				this.#throwIfRootScanCancelled(root)
				run(
					database,
					`UPDATE index_roots
					SET scan_generation = ?,
						state = CASE WHEN last_successful_scan_at IS NULL THEN 'warming' ELSE state END,
						last_error = NULL,
						updated_at = ?
					WHERE id = ?`,
					generation,
					Date.now(),
					root.id,
				)
			})
			root.scanGeneration = generation

			// Root scans are serialized, so this table contains only the current
			// snapshot. An unqualified delete lets SQLite clear it efficiently after
			// a failed scan without walking every temporary row.
			await this.#mutate((database) => run(database, 'DELETE FROM reconciliation_seen'))
			let batch: EntryWrite[] = []
			for await (const entry of this.#walkTree(
				root.systemPath,
				() => this.#rootScanCancelled(root),
				(systemPath) => this.#shouldIndexSystemPath(root, systemPath),
				(systemPath, error) => unreadablePaths.set(relativePathWithin(root.systemPath, systemPath), error),
			)) {
				const write = this.#entryWrite(root, entry.systemPath, entry.stats)
				if (!write) continue
				batch.push(write)
				indexedEntries++
				if (batch.length >= this.#batchSize) {
					this.#throwIfRootScanCancelled(root)
					await this.#writeEntries(batch, 0, true)
					batch = []
					await new Promise<void>((resolve) => setImmediate(resolve))
					await this.#drainPendingLiveWork(MAX_LIVE_WORK_PER_SCAN_BATCH)
				}
			}
			this.#throwIfRootScanCancelled(root)
			if (batch.length > 0) await this.#writeEntries(batch, 0, true)
			await new Promise<void>((resolve) => setImmediate(resolve))
			await this.#drainPendingLiveWork(Number.POSITIVE_INFINITY)
			this.#throwIfRootScanCancelled(root)
			if (activeSnapshot.rerunRequested) {
				await this.#mutate((database) => run(database, 'DELETE FROM reconciliation_seen'))
				this.logger.log(`Superseded reconciliation for '${root.virtualPath}'; scheduling a fresh snapshot`)
				return
			}
			if (unreadablePaths.size > 0) {
				await this.#markReconciliationPathsSeen(root, unreadablePaths.keys())
			}

			const completedAt = Date.now()
			const partialError = unreadablePaths.size > 0 ? unreadableReconciliationError(root, unreadablePaths) : undefined
			await this.#mutate((database) => {
				this.#throwIfRootScanCancelled(root)
				const finishScan = database.transaction(() => {
					run(
						database,
						`DELETE FROM entries
						WHERE root_id = ?
							AND NOT EXISTS (
								SELECT 1
								FROM reconciliation_seen
								WHERE reconciliation_seen.root_id = entries.root_id
									AND reconciliation_seen.relative_path = entries.relative_path
							)`,
						root.id,
					)
					run(database, 'DELETE FROM reconciliation_seen')
					run(
						database,
						`UPDATE index_roots SET
							state = ?,
							last_successful_scan_at = COALESCE(?, last_successful_scan_at),
							last_error = ?,
							updated_at = ?
						WHERE id = ?`,
						partialError ? 'degraded' : 'ready',
						partialError ? null : completedAt,
						partialError?.message ?? null,
						completedAt,
						root.id,
					)
				})
				finishScan.immediate()
			})

			if (partialError) {
				root.state = 'degraded'
				root.lastError = partialError.message
				this.logger.error(
					`Partially reconciled '${root.virtualPath}' in ${completedAt - startedAt}ms (${indexedEntries} entries)`,
					partialError,
				)
			} else {
				root.state = 'ready'
				root.lastSuccessfulScanAt = completedAt
				root.lastError = undefined
				this.logger.log(`Reconciled '${root.virtualPath}' in ${completedAt - startedAt}ms (${indexedEntries} entries)`)
			}
		} catch (error) {
			if (!(error instanceof ScanCancelledError) && this.#roots.get(root.virtualPath) === root) {
				await this.#degradeRoot(root, error)
				this.logger.error(`Failed to reconcile '${root.virtualPath}'`, error)
			}
		} finally {
			if (this.#activeRootSnapshot === activeSnapshot) this.#activeRootSnapshot = undefined
			this.#releasePendingLiveWork()
		}
	}

	#rootScanCancelled(root: RootState) {
		return this.#stopping || this.#roots.get(root.virtualPath) !== root
	}

	#throwIfRootScanCancelled(root: RootState) {
		if (this.#rootScanCancelled(root)) throw new ScanCancelledError(`File index root '${root.virtualPath}' changed`)
	}

	async #markReconciliationPathsSeen(root: RootState, relativePaths: Iterable<string>) {
		if (!root.id) return
		await this.#mutate((database) => {
			const markProtected = database.transaction((relativePaths: Iterable<string>) => {
				const markPrefix = database.prepare(`
					INSERT OR IGNORE INTO reconciliation_seen(root_id, relative_path)
					SELECT root_id, relative_path
					FROM entries
					WHERE root_id = ?
						AND (
							relative_path = ?
							OR (relative_path >= ? AND relative_path < ?)
						)
				`)

				for (const relativePath of relativePaths) {
					if (relativePath === '') throw new Error(`Cannot partially reconcile unreadable root '${root.virtualPath}'`)
					const prefix = `${relativePath}/`
					markPrefix.run(root.id, relativePath, prefix, `${relativePath}0`)
				}
			})
			markProtected.immediate(relativePaths)
		})
	}

	#scheduleLiveWork(operation: () => Promise<void>, priority: number, cost = 1) {
		return new Promise<void>((resolve, reject) => {
			const pending: PendingLiveWork = {
				operation,
				priority,
				cost,
				sequence: this.#nextLiveWorkSequence++,
				resolve,
				reject,
			}
			if (this.#activeRootSnapshot) this.#pendingLiveWork.push(pending)
			else this.#enqueueLiveWork(pending)
		})
	}

	#enqueueLiveWork(pending: PendingLiveWork) {
		void (this.#scanQueue.add(pending.operation, {priority: pending.priority}) as Promise<void>).then(
			() => pending.resolve(),
			(error) => pending.reject(error),
		)
	}

	async #drainPendingLiveWork(limit: number) {
		if (limit <= 0 || this.#pendingLiveWork.length === 0) return
		this.#pendingLiveWork.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
		let cost = 0
		let count = 0
		while (count < this.#pendingLiveWork.length) {
			const nextCost = this.#pendingLiveWork[count].cost
			if (count > 0 && cost + nextCost > limit) break
			cost += nextCost
			count++
			if (cost >= limit) break
		}
		const pending = this.#pendingLiveWork.splice(0, count)
		for (const item of pending) {
			try {
				await item.operation()
				item.resolve()
			} catch (error) {
				item.reject(error)
			}
		}
	}

	#releasePendingLiveWork() {
		const pending = this.#pendingLiveWork.splice(0)
		for (const item of pending) this.#enqueueLiveWork(item)
	}

	noteWatcherChanges(virtualPath: string, events: readonly WatcherChange[]) {
		if (!this.#started || this.#stopping || events.length === 0) return
		const root = this.#roots.get(nodePath.posix.normalize(virtualPath))
		if (!root) return

		// Parcel has already debounced and coalesced this callback to at most one
		// event per path. Large native batches are cheaper to cover with one root
		// snapshot; small batches can be processed directly without rebuilding a
		// second JavaScript debounce/deduplication layer.
		if (events.length >= this.#watcherBulkThreshold) {
			this.noteWatcherBurst(root.virtualPath)
			return
		}

		for (let offset = 0; offset < events.length; offset += MAX_LIVE_WORK_PER_SCAN_BATCH) {
			const batch = events.slice(offset, offset + MAX_LIVE_WORK_PER_SCAN_BATCH)
			void this.#scheduleLiveWork(
				async () => {
					for (const {path: systemPath, type} of batch) {
						// A newly visible directory may already contain files (for example,
						// an atomic move into the watched root). Use the existing coalesced
						// root snapshot rather than maintaining a second subtree crawler.
						// Directory updates only describe the directory inode; Parcel reports
						// child changes separately. Re-scanning the whole root for each one
						// turns modest directory churn into repeated million-entry walks.
						const directoryReconciliation = type === 'create' ? 'root' : 'entry'
						await this.#reconcileSystemPath(systemPath, 5, directoryReconciliation).catch((error) => {
							this.logger.error(`Failed to update file index for '${systemPath}'`, error)
						})
					}
				},
				5,
				batch.length,
			).catch((error) => this.logger.error(`Failed to process file event batch for '${root.virtualPath}'`, error))
		}
	}

	noteWatcherBurst(virtualPath: string) {
		if (!this.#started || this.#stopping) return
		const root = this.#roots.get(nodePath.posix.normalize(virtualPath))
		if (!root) return
		void this.reconcileRoot(root.virtualPath, 'watcher-burst').catch((error) =>
			this.logger.error(`Failed to reconcile watcher burst for '${root.virtualPath}'`, error),
		)
	}

	async reconcilePath(systemPath: string) {
		if (!this.#rootForSystemPath(systemPath) || !this.#available) return
		await this.#schedulePathReconciliation(systemPath, 10, 'root')
	}

	async #schedulePathReconciliation(
		systemPath: string,
		priority: number,
		directoryReconciliation: DirectoryReconciliation,
	) {
		let completion: Promise<void> | undefined
		await this.#scheduleLiveWork(async () => {
			completion = (await this.#reconcileSystemPath(systemPath, priority, directoryReconciliation))?.completion
		}, priority)
		await completion
	}

	async removePath(systemPath: string) {
		const root = this.#rootForSystemPath(systemPath)
		if (!root?.id || !this.#available) return
		await this.#scheduleLiveWork(async () => {
			const relativePath = relativePathWithin(root.systemPath, systemPath)
			try {
				await this.#deleteRelativePath(root, relativePath, 10)
			} catch (error) {
				await this.#degradeRoot(root, error)
				throw error
			}
		}, 10)
	}

	async movePath(sourceSystemPath: string, destinationSystemPath: string) {
		const results = await Promise.allSettled([
			this.removePath(sourceSystemPath),
			this.reconcilePath(destinationSystemPath),
		])
		const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
		if (failure) throw failure.reason
	}

	async #reconcileSystemPath(
		systemPath: string,
		priority: number,
		directoryReconciliation: DirectoryReconciliation,
	): Promise<PathReconciliationResult | undefined> {
		const root = this.#rootForSystemPath(systemPath)
		if (!root?.id || !this.#available || this.#stopping) return
		try {
			const relativePath = relativePathWithin(root.systemPath, systemPath)
			if (isReservedMemberTrashPath(root, relativePath)) {
				await this.#deleteRelativePath(root, relativePath, priority)
				return
			}
			let stats: Stats
			try {
				stats = await lstat(systemPath)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					await this.#deleteRelativePath(root, relativePath, priority)
					return
				}
				throw error
			}

			if (relativePath === '') {
				return {completion: this.reconcileRoot(root.virtualPath, 'root-hint')}
			}

			if (stats.isDirectory() && directoryReconciliation === 'root') {
				// A directory event does not tell us which children changed. A full root
				// scan is the smallest simple operation that can also remove stale rows.
				return {completion: this.reconcileRoot(root.virtualPath, 'directory-changed')}
			}

			const first = this.#entryWrite(root, systemPath, stats)
			if (first) await this.#writeEntries([first], priority)
			return {}
		} catch (error) {
			if (!(error instanceof ScanCancelledError) && this.#roots.get(root.virtualPath) === root) {
				await this.#degradeRoot(root, error)
			}
			throw error
		}
	}

	#entryWrite(root: RootState, systemPath: string, stats: Stats): EntryWrite | undefined {
		if (!root.id) return undefined
		const relativePath = relativePathWithin(root.systemPath, systemPath)
		if (relativePath === '' || isReservedMemberTrashPath(root, relativePath)) return undefined
		const name = nodePath.basename(systemPath)
		const type = entryType(stats)

		return {
			rootId: root.id,
			relativePath,
			name,
			type,
			size: stats.size,
			modifiedMs: Math.trunc(stats.mtimeMs),
			hidden: Number(this.#isHidden(name)),
		}
	}

	#shouldIndexSystemPath(root: RootState, systemPath: string) {
		return !isReservedMemberTrashPath(root, relativePathWithin(root.systemPath, systemPath))
	}

	async #writeEntries(entries: EntryWrite[], priority = 0, markSeen = false) {
		if (entries.length === 0) return
		const activeRootId = this.#activeRootSnapshot?.root.id
		if (activeRootId && entries.every(({rootId}) => rootId === activeRootId)) markSeen = true
		await this.#mutate((database) => this.#applyPathMutation(database, {type: 'write', entries, markSeen}), priority)
	}

	async #deleteRelativePath(root: RootState, relativePath: string, priority: number) {
		const rootId = root.id
		if (!rootId) return
		await this.#mutate(
			(database) => this.#applyPathMutation(database, {type: 'delete', rootId, relativePath}),
			priority,
		)
	}

	#applyPathMutation(database: Database, mutation: PathMutation) {
		const apply = database.transaction((mutation: PathMutation) => {
			if (mutation.type === 'delete') {
				if (mutation.relativePath === '') {
					run(database, 'DELETE FROM entries WHERE root_id = ?', mutation.rootId)
					run(database, 'DELETE FROM reconciliation_seen WHERE root_id = ?', mutation.rootId)
					return
				}
				// SQLite's default binary ordering places every `path/...`
				// descendant between `path/` and the next string, `path0`. This
				// range can use the (root_id, relative_path) index directly.
				const prefix = `${mutation.relativePath}/`
				const prefixEnd = `${mutation.relativePath}0`
				run(
					database,
					'DELETE FROM entries WHERE root_id = ? AND relative_path = ?',
					mutation.rootId,
					mutation.relativePath,
				)
				run(
					database,
					`DELETE FROM entries
						WHERE root_id = ? AND relative_path >= ? AND relative_path < ?`,
					mutation.rootId,
					prefix,
					prefixEnd,
				)
				run(
					database,
					'DELETE FROM reconciliation_seen WHERE root_id = ? AND relative_path = ?',
					mutation.rootId,
					mutation.relativePath,
				)
				run(
					database,
					`DELETE FROM reconciliation_seen
						WHERE root_id = ? AND relative_path >= ? AND relative_path < ?`,
					mutation.rootId,
					prefix,
					prefixEnd,
				)
				return
			}

			const writeStatement = database.prepare(`
				INSERT INTO entries(
						root_id, relative_path, name, search_name, search_name_folded,
						type, size, modified_ms, hidden
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(root_id, relative_path) DO UPDATE SET
						name = excluded.name,
						search_name = excluded.search_name,
						search_name_folded = excluded.search_name_folded,
						type = excluded.type,
						size = excluded.size,
						modified_ms = excluded.modified_ms,
						hidden = excluded.hidden
					WHERE entries.name IS NOT excluded.name
						OR entries.search_name IS NOT excluded.search_name
						OR entries.search_name_folded IS NOT excluded.search_name_folded
						OR entries.type IS NOT excluded.type
						OR entries.size IS NOT excluded.size
						OR entries.modified_ms IS NOT excluded.modified_ms
						OR entries.hidden IS NOT excluded.hidden
			`)
			const markSeenStatement = mutation.markSeen
				? database.prepare(`
						INSERT INTO reconciliation_seen(root_id, relative_path)
						VALUES (?, ?)
						ON CONFLICT(root_id, relative_path) DO NOTHING
					`)
				: undefined

			for (const entry of mutation.entries) {
				markSeenStatement?.run(entry.rootId, entry.relativePath)
				writeStatement.run(
					entry.rootId,
					entry.relativePath,
					entry.name,
					entry.name.normalize('NFC'),
					foldSearchName(entry.name),
					entry.type,
					entry.size,
					entry.modifiedMs,
					entry.hidden,
				)
			}
		})
		apply.immediate(mutation)
	}

	async getEntryByVirtualPath(virtualPath: string): Promise<IndexedEntry | undefined> {
		const root = this.#rootForVirtualPath(virtualPath)
		if (!root?.id || !this.#available) return undefined
		const relativePath = relativeVirtualPath(root.virtualPath, virtualPath)
		if (relativePath === '' || isReservedMemberTrashPath(root, relativePath)) return undefined
		const row = get(
			this.#requireDatabase(),
			`${entrySelectSql()} WHERE entries.root_id = ? AND entries.relative_path = ?`,
			root.id,
			relativePath,
		) as EntryRow | undefined
		return row ? indexedEntry(row) : undefined
	}

	async getEntryBySystemPath(systemPath: string): Promise<IndexedEntry | undefined> {
		const root = this.#rootForSystemPath(systemPath)
		if (!root?.id || !this.#available) return undefined
		const relativePath = relativePathWithin(root.systemPath, systemPath)
		if (relativePath === '' || isReservedMemberTrashPath(root, relativePath)) return undefined
		const row = get(
			this.#requireDatabase(),
			`${entrySelectSql()} WHERE entries.root_id = ? AND entries.relative_path = ?`,
			root.id,
			relativePath,
		) as EntryRow | undefined
		return row ? indexedEntry(row) : undefined
	}

	async searchCandidates(virtualRoot: string, query: string, maxResults: number): Promise<SearchCandidate[]> {
		if (query.includes('\0')) throw new TypeError('File search queries cannot contain NUL')
		if (!Number.isSafeInteger(maxResults) || maxResults <= 0) {
			throw new TypeError('File search maxResults must be a positive integer')
		}
		const root = this.#roots.get(virtualRoot)
		if (!root?.id || !root.searchEnabled || !this.#available) {
			throw new Error(`File index root '${virtualRoot}' is unavailable`)
		}
		const rootId = root.id

		return (await this.#mutationQueue.add(() => {
			const foldedQuery = foldSearchName(query)
			let matches = new Map<number, SearchCandidate & {exact: boolean; score: number}>()
			const bestMatches = () =>
				[...matches.values()]
					.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.id - b.id)
					.slice(0, maxResults)

			for (const rows of searchRowPhases(this.#requireDatabase(), rootId, query, maxResults)) {
				for (const row of rows) {
					if (isReservedMemberTrashPath(root, row.relative_path)) continue
					const exact = foldSearchName(row.name) === foldedQuery
					const score = exact ? 1 : fuzzy(query, row.name)
					if (!exact && score <= SEARCH_MATCH_THRESHOLD) continue
					const id = Number(row.id)
					const existing = matches.get(id)
					if (existing && (existing.exact || (!exact && existing.score >= score))) continue
					matches.set(id, {
						id,
						name: row.name,
						virtualPath: joinVirtualPath(root.virtualPath, row.relative_path),
						exact,
						score,
					})
					if (matches.size >= MAX_MATCHES_DURING_SEARCH) {
						matches = new Map(bestMatches().map((match) => [match.id, match]))
					}
				}
			}
			return bestMatches().map(({id, name, virtualPath}) => ({id, name, virtualPath}))
		})) as SearchCandidate[]
	}

	async status() {
		let entryCount = 0
		if (this.#available) {
			const row = get(this.#requireDatabase(), 'SELECT COUNT(*) AS count FROM entries') as {count: number}
			entryCount = Number(row.count)
		}

		return {
			available: this.#available,
			schemaVersion: this.#schemaVersion,
			entryCount,
			roots: [...this.#roots.values()].map((root) => ({
				virtualPath: root.virtualPath,
				state: root.state,
				scanGeneration: root.scanGeneration,
				lastSuccessfulScanAt: root.lastSuccessfulScanAt,
				lastError: root.lastError,
			})),
		}
	}

	async #degradeRoot(root: RootState, error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		root.state = 'degraded'
		root.lastError = message
		if (!root.id || !this.#available) return
		await this.#mutate((database) =>
			run(
				database,
				`UPDATE index_roots SET state = 'degraded', last_error = ?, updated_at = ? WHERE id = ?`,
				message,
				Date.now(),
				root.id,
			),
		).catch(() => {})
	}

	#rootForSystemPath(systemPath: string) {
		const normalized = nodePath.resolve(systemPath)
		return [...this.#roots.values()]
			.filter((root) => isPathInsideOrEqual(root.systemPath, normalized))
			.sort((a, b) => b.systemPath.length - a.systemPath.length)[0]
	}

	#rootForVirtualPath(virtualPath: string) {
		const normalized = nodePath.posix.normalize(virtualPath)
		return [...this.#roots.values()]
			.filter((root) => normalized === root.virtualPath || normalized.startsWith(`${root.virtualPath}/`))
			.sort((a, b) => b.virtualPath.length - a.virtualPath.length)[0]
	}

	async #mutate<T>(operation: (database: Database) => T | Promise<T>, priority = 0): Promise<T> {
		return (await this.#mutationQueue.add(() => operation(this.#requireDatabase()), {priority})) as T
	}

	#requireDatabase() {
		if (!this.#database) throw new Error('File index is unavailable')
		return this.#database
	}

	#setAvailable(available: boolean) {
		if (this.#available === available) return
		this.#available = available
		this.#onAvailabilityChange?.(available)
	}

	async stop() {
		if (!this.#started) return
		this.#stopping = true
		if (this.#reconciliationTimer) clearTimeout(this.#reconciliationTimer)
		if (this.#recoveryTimer) clearTimeout(this.#recoveryTimer)
		this.#reconciliationTimer = undefined
		this.#recoveryTimer = undefined
		await this.#recoveryAttempt
		await this.#scanQueue.onIdle()
		await this.#mutationQueue.onIdle()
		try {
			this.#database?.close()
		} catch (error) {
			this.logger.error('Failed to close file index', error)
		}
		this.#database = undefined
		this.#setAvailable(false)
		this.#started = false
	}
}

function queryTrigrams(query: string) {
	const characters = Array.from(query)
	// FTS5's trigram tokenizer cannot index shorter terms.
	if (characters.length < MIN_TRIGRAM_QUERY_LENGTH) return

	// Quote grams individually so punctuation is always treated as indexed text.
	// Search phases decide how strictly those terms are combined.
	const trigrams = new Set<string>()
	for (let index = 0; index <= characters.length - 3; index++) {
		trigrams.add(characters.slice(index, index + 3).join(''))
	}
	return [...trigrams]
}

function quoteFtsTerm(term: string) {
	return `"${term.replaceAll('"', '""')}"`
}

function ftsConjunction(terms: string[]) {
	return terms.map(quoteFtsTerm).join(' AND ')
}

function relaxedFtsExpression(terms: string[], omittedCount: number) {
	const expressions: string[] = []
	const omitted: number[] = []
	const chooseOmitted = (start: number) => {
		if (omitted.length === omittedCount) {
			const omittedSet = new Set(omitted)
			expressions.push(`(${ftsConjunction(terms.filter((_, index) => !omittedSet.has(index)))})`)
			return
		}
		for (let index = start; index < terms.length; index++) {
			omitted.push(index)
			chooseOmitted(index + 1)
			omitted.pop()
		}
	}
	chooseOmitted(0)
	return expressions.join(' OR ')
}

function rareTrigrams(database: Database, trigrams: string[]) {
	return trigrams
		.map((term, index) => {
			const variants = [...new Set([term, term.toLowerCase(), term.toUpperCase()])].filter(
				(variant) => Array.from(variant).length === MIN_TRIGRAM_QUERY_LENGTH,
			)
			const placeholders = variants.map(() => '?').join(', ')
			const row = database
				.prepare(
					`SELECT term, doc FROM entry_names_fts_vocab
					WHERE term IN (${placeholders})
					ORDER BY doc, term
					LIMIT 1`,
				)
				.get(...variants) as FtsVocabularyRow | undefined
			return {index, row}
		})
		.filter((candidate): candidate is {index: number; row: FtsVocabularyRow} => candidate.row !== undefined)
		.sort((left, right) => left.row.doc - right.row.doc || left.index - right.index)
		.slice(0, MAX_RARE_TRIGRAMS)
		.map(({row}) => row.term)
}

function ftsRows(database: Database, rootId: number, expression: string, limit: number) {
	return database
		.prepare(
			`SELECT entries.id, entries.name, entries.relative_path
			FROM entry_names_fts
			JOIN entries ON entries.id = entry_names_fts.rowid
			WHERE entry_names_fts MATCH ?
				AND entries.root_id = ?
				AND entries.hidden = 0
			LIMIT ?`,
		)
		.iterate(expression, rootId, limit) as Iterable<SearchRow>
}

function ftsSubstringRows(database: Database, rootId: number, query: string, limit: number) {
	return database
		.prepare(
			`SELECT entries.id, entries.name, entries.relative_path
			FROM entry_names_fts
			JOIN entries ON entries.id = entry_names_fts.rowid
			WHERE entry_names_fts.search_name LIKE ?
				AND entries.root_id = ?
				AND entries.hidden = 0
			LIMIT ?`,
		)
		.iterate(`%${query}%`, rootId, limit) as Iterable<SearchRow>
}

function shortSubstringRows(database: Database, rootId: number, foldedQuery: string) {
	return database
		.prepare(
			`SELECT id, name, relative_path
			FROM entries
			WHERE root_id = ?
				AND hidden = 0
				AND instr(search_name_folded, ?) > 0
			LIMIT ?`,
		)
		.iterate(rootId, foldedQuery, MAX_SHORT_QUERY_CANDIDATES) as Iterable<SearchRow>
}

function exactNameRows(database: Database, rootId: number, foldedQuery: string, limit: number) {
	return database
		.prepare(
			`SELECT id, name, relative_path
			FROM entries
			WHERE root_id = ?
				AND hidden = 0
				AND search_name_folded = ?
			LIMIT ?`,
		)
		.iterate(rootId, foldedQuery, limit) as Iterable<SearchRow>
}

function* searchRowPhases(
	database: Database,
	rootId: number,
	query: string,
	maxResults: number,
): Generator<Iterable<SearchRow>> {
	const normalizedQuery = query.normalize('NFC')
	const foldedQuery = foldSearchName(query)
	if (!foldedQuery) return
	const candidateLimit = Math.min(
		MAX_FTS_CANDIDATES,
		Math.max(MIN_FTS_CANDIDATES, maxResults * FTS_CANDIDATES_PER_RESULT),
	)
	// Exact whole-name matches use a separate B-tree lookup so they cannot be
	// displaced by an FTS candidate limit or by equally scored substrings.
	yield exactNameRows(database, rootId, foldedQuery, candidateLimit)

	const trigrams = queryTrigrams(normalizedQuery)
	// FTS5 cannot represent one- and two-character terms. Keep those searches
	// useful with a bounded literal substring scan over the folded filename.
	if (!trigrams) {
		yield shortSubstringRows(database, rootId, foldedQuery)
		return
	}

	// FTS5's trigram tokenizer accelerates LIKE and verifies that the complete
	// query is contiguous before LIMIT is applied. This prevents non-contiguous
	// trigram decoys from displacing a stronger substring candidate. LIKE's two
	// wildcard characters are intentionally left to the MATCH phases below.
	if (!normalizedQuery.includes('%') && !normalizedQuery.includes('_')) {
		yield ftsSubstringRows(database, rootId, normalizedQuery, candidateLimit)
	}

	// The full conjunction is a cheap exact-substring-like path and avoids
	// ranking large posting-list unions for ordinary searches.
	yield ftsRows(database, rootId, ftsConjunction(trigrams), candidateLimit)
	// One edit can replace every trigram in a five-character query. Keep these
	// searches fast and exact instead of pretending the index can provide
	// reliable typo recall or falling back to a million-row scan.
	if (Array.from(normalizedQuery).length < MIN_FUZZY_TRIGRAM_QUERY_LENGTH) return

	// If the strict query produced no fuzzy matches, progressively relax a
	// small set of the rarest surviving grams. This keeps typo lookup narrow
	// while allowing locally damaged trigrams to be omitted.
	const anchors = rareTrigrams(database, trigrams)
	if (anchors.length === 0) return
	yield ftsRows(database, rootId, ftsConjunction(anchors), candidateLimit)

	const omittedCounts = new Set<number>()
	if (anchors.length >= 3) omittedCounts.add(1)
	if (anchors.length >= 4) omittedCounts.add(2)
	if (anchors.length >= 5) omittedCounts.add(anchors.length - 2)
	if (trigrams.length <= 5 && anchors.length >= 2) omittedCounts.add(anchors.length - 1)
	for (const omittedCount of omittedCounts) {
		yield ftsRows(database, rootId, relaxedFtsExpression(anchors, omittedCount), candidateLimit)
	}
}

function databaseQuarantineReason(error: unknown) {
	if (error instanceof UnsupportedFileIndexSchemaError) return 'unsupported-schema'
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	if (
		message.includes('corrupt') ||
		message.includes('malformed') ||
		message.includes('not a database') ||
		message.includes('short read on page')
	) {
		return 'corrupt'
	}
}

function isPathInsideOrEqual(basePath: string, candidatePath: string) {
	const relative = nodePath.relative(nodePath.resolve(basePath), nodePath.resolve(candidatePath))
	return (
		relative === '' ||
		(!relative.startsWith(`..${nodePath.sep}`) && relative !== '..' && !nodePath.isAbsolute(relative))
	)
}

function sameRootDefinition(left: FileIndexRoot, right: FileIndexRoot) {
	return (
		left.virtualPath === right.virtualPath &&
		left.systemPath === right.systemPath &&
		left.ownerId === right.ownerId &&
		left.kind === right.kind &&
		left.searchEnabled === right.searchEnabled
	)
}

function isReservedMemberTrashPath(root: FileIndexRoot, relativePath: string) {
	return (
		root.kind === 'home' &&
		root.virtualPath === `/Users/${root.ownerId}` &&
		(relativePath === 'Trash' || relativePath.startsWith('Trash/'))
	)
}

function relativePathWithin(rootSystemPath: string, systemPath: string) {
	const relative = nodePath.relative(nodePath.resolve(rootSystemPath), nodePath.resolve(systemPath))
	if (relative === '') return ''
	if (relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
		throw new Error(`Path '${systemPath}' is outside index root '${rootSystemPath}'`)
	}
	return relative.split(nodePath.sep).join('/')
}

function relativeVirtualPath(rootVirtualPath: string, virtualPath: string) {
	const root = nodePath.posix.normalize(rootVirtualPath)
	const candidate = nodePath.posix.normalize(virtualPath)
	if (candidate === root) return ''
	if (!candidate.startsWith(`${root}/`))
		throw new Error(`Path '${virtualPath}' is outside index root '${rootVirtualPath}'`)
	const relative = candidate.slice(root.length + 1)
	if (!relative || relative.startsWith('../') || relative.includes('\0'))
		throw new Error(`Invalid indexed path '${virtualPath}'`)
	return relative
}

function joinVirtualPath(rootVirtualPath: string, relativePath: string) {
	if (
		!relativePath ||
		nodePath.posix.isAbsolute(relativePath) ||
		relativePath === '..' ||
		relativePath.startsWith('../') ||
		relativePath.includes('/../') ||
		relativePath.includes('\0')
	) {
		throw new Error(`Invalid relative path in file index: '${relativePath}'`)
	}
	return nodePath.posix.join(rootVirtualPath, relativePath)
}

function entryType(stats: Stats): EntryType {
	if (stats.isDirectory()) return 'directory'
	if (stats.isSymbolicLink()) return 'symbolic-link'
	if (stats.isSocket()) return 'socket'
	if (stats.isBlockDevice()) return 'block-device'
	if (stats.isCharacterDevice()) return 'character-device'
	if (stats.isFIFO()) return 'fifo'
	return 'file'
}

function entrySelectSql() {
	return `SELECT
		entries.*,
		index_roots.virtual_path AS root_virtual_path,
		index_roots.system_path AS root_system_path
	FROM entries
	JOIN index_roots ON index_roots.id = entries.root_id`
}

function indexedEntry(row: EntryRow): IndexedEntry {
	return {
		id: Number(row.id),
		rootId: Number(row.root_id),
		rootVirtualPath: row.root_virtual_path,
		virtualPath: joinVirtualPath(row.root_virtual_path, row.relative_path),
		systemPath: nodePath.join(row.root_system_path, ...row.relative_path.split('/')),
		relativePath: row.relative_path,
		name: row.name,
		type: row.type,
		size: Number(row.size),
		modifiedMs: Number(row.modified_ms),
		hidden: Boolean(row.hidden),
	}
}

function run(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).run(...parameters)
}

function get(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).get(...parameters)
}

function all(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).all(...parameters)
}
