import {constants as fsConstants} from 'node:fs'
import {mkdir, open, opendir} from 'node:fs/promises'
import nodePath from 'node:path'
import {createHash, randomUUID} from 'node:crypto'

import {Blake3Hasher} from '@napi-rs/blake-hash'
import type DatabaseTypes from 'better-sqlite3'
import {execa} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import {
	THUMBNAIL_FORMAT,
	THUMBNAIL_HEIGHT,
	THUMBNAIL_QUALITY,
	THUMBNAIL_VARIANT,
	THUMBNAIL_WIDTH,
	thumbnailSystemPath,
	type ThumbnailIdentity,
	type ThumbnailIdentityKind,
} from './thumbnail-support.js'

type Database = DatabaseTypes.Database

const BACKGROUND_DATABASE_PRIORITY = -10
const ON_DEMAND_DATABASE_PRIORITY = 20
const HASH_RETRY_BASE_MS = 30_000
const THUMBNAIL_RETRY_BASE_MS = 60_000
const MAX_RETRY_MS = 24 * 60 * 60 * 1000
const IDLE_RECHECK_MS = 60_000
const INFRASTRUCTURE_RETRY_MS = 60_000
const ARTIFACT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
const ARTIFACT_MAINTENANCE_BATCH_SIZE = 256
const ORPHAN_SWEEP_BATCH_SIZE = 256
const ARTIFACT_IO_CONCURRENCY = 16
export const BACKGROUND_QUIET_PERIOD_MS = 1_000
export const THUMBNAIL_GENERATION_TIMEOUT_MS = 60_000
export const ORPHAN_GC_MAX_DEFERRAL_MS = 6 * 60 * 60 * 1000
const TEMPORARY_ARTIFACT_GRACE_MS = 2 * THUMBNAIL_GENERATION_TIMEOUT_MS

const THUMBNAIL_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024
const THUMBNAIL_MAP_LIMIT_BYTES = 512 * 1024 * 1024
const THUMBNAIL_DISK_LIMIT_BYTES = 1024 * 1024 * 1024
const THUMBNAIL_THREAD_LIMIT = 1

export type ContentFingerprint = {
	inode: string
	size: number
	modifiedNs: string
	ctimeNs: string
}

export type ThumbnailReference = {
	kind: ThumbnailIdentityKind
	key: string
	variant: typeof THUMBNAIL_VARIANT
	format: typeof THUMBNAIL_FORMAT
}

type EntryCandidate = ContentFingerprint & {
	id: number
	device: string
	systemPath: string
	thumbnailIdentityKind: ThumbnailIdentityKind
}

type ContentCandidate = {
	id: number
	entryId: number
	hash: string
	systemPath: string
	fingerprint: ContentFingerprint
}

type OrphanedContent = {id: number; key: string}
type OrphanedContentRow = {id: number; hash: string}
type OrphanMaintenance = {processed: boolean; orphans: OrphanedContent[]}
type ReadyThumbnail = {contentId: number; key: string}

export type FileIndexEnrichmentLogger = {
	log(message?: string): void
	verbose(message: string): void
	error(message: string, error?: unknown): void
}

export type FileIndexEnrichmentOptions = {
	dataDirectory: string
	logger: FileIndexEnrichmentLogger
	withDatabase: <T>(operation: (database: Database) => T, priority?: number) => Promise<T>
	onStalePath: (systemPath: string) => Promise<void>
}

export type FileIndexEnrichmentRuntime = {
	hashFile?: typeof hashFileRevision
	generateThumbnail?: typeof generateThumbnailFile
	thumbnailIsUsable?: typeof thumbnailArtifactIsUsable
	remove?: typeof fse.remove
	orphanGcMaxDeferralMs?: number
}

class StaleFileRevisionError extends Error {}
class PersistedEnrichmentFailure extends Error {
	constructor(cause: unknown) {
		super(errorMessage(cause), {cause})
		this.name = 'PersistedEnrichmentFailure'
	}
}

export default class FileIndexEnrichment {
	readonly thumbnailDirectory: string
	readonly logger: FileIndexEnrichmentLogger

	#withDatabase: FileIndexEnrichmentOptions['withDatabase']
	#onStalePath: (systemPath: string) => Promise<void>
	#hashFile: typeof hashFileRevision
	#generateThumbnail: typeof generateThumbnailFile
	#thumbnailIsUsable: typeof thumbnailArtifactIsUsable
	#remove: typeof fse.remove
	#orphanGcMaxDeferralMs: number
	#backgroundQueue = new PQueue({concurrency: 1})
	#onDemandQueue = new PQueue({concurrency: 1})
	#started = false
	#stopping = false
	#backgroundEnabled = false
	#backgroundQueued = false
	#wakeRequested = false
	#timer?: ReturnType<typeof setTimeout>
	#orphanSweepCursor?: number
	#thumbnailVerificationCursor?: number
	#thumbnailVerificationCompletedAt = 0
	#artifactFiles?: AsyncGenerator<string>
	#artifactMaintenanceCompletedAt = 0
	#destructiveArtifactMaintenanceAllowed = false
	#directoryPublication = new Map<string, Promise<void>>()
	#artifactOperations = new Map<string, Promise<void>>()

	constructor(
		{dataDirectory, logger, withDatabase, onStalePath}: FileIndexEnrichmentOptions,
		{
			hashFile = hashFileRevision,
			generateThumbnail = generateThumbnailFile,
			thumbnailIsUsable = thumbnailArtifactIsUsable,
			remove = fse.remove,
			orphanGcMaxDeferralMs = ORPHAN_GC_MAX_DEFERRAL_MS,
		}: FileIndexEnrichmentRuntime = {},
	) {
		this.thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
		this.logger = logger
		this.#withDatabase = withDatabase
		this.#onStalePath = onStalePath
		this.#hashFile = hashFile
		this.#generateThumbnail = generateThumbnail
		this.#thumbnailIsUsable = thumbnailIsUsable
		this.#remove = remove
		this.#orphanGcMaxDeferralMs = orphanGcMaxDeferralMs
	}

	async start() {
		if (this.#started) return
		this.#started = true
		this.#stopping = false
		this.#orphanSweepCursor = 0
		this.#thumbnailVerificationCursor = undefined
		this.#thumbnailVerificationCompletedAt = 0
		this.#artifactFiles = undefined
		this.#artifactMaintenanceCompletedAt = 0
		this.#destructiveArtifactMaintenanceAllowed = false
		this.#directoryPublication.clear()
		this.#artifactOperations.clear()
		this.#wakeRequested = false
		await this.#ensureArtifactDirectory(this.thumbnailDirectory).catch((error) =>
			this.logger.error('Thumbnail artifact storage is unavailable; file indexing will continue', error),
		)
	}

	startBackground() {
		this.#backgroundEnabled = true
		this.kick()
	}

	allowDestructiveArtifactMaintenance() {
		if (this.#destructiveArtifactMaintenanceAllowed) return
		this.#destructiveArtifactMaintenanceAllowed = true
		this.kick()
	}

	kick() {
		if (!this.#started || this.#stopping || !this.#backgroundEnabled) return
		if (this.#backgroundQueued) {
			this.#wakeRequested = true
			return
		}
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = undefined
		this.#backgroundQueued = true
		void (this.#backgroundQueue.add(() => this.#backgroundStep()) as Promise<void>)
			.catch((error) => this.logger.error('File enrichment background step failed', error))
			.finally(() => {
				this.#backgroundQueued = false
				if (this.#stopping || !this.#backgroundEnabled) return
				if (this.#wakeRequested) {
					this.#wakeRequested = false
					this.kick()
				} else if (!this.#timer) {
					this.#schedule(IDLE_RECHECK_MS)
				}
			})
	}

	async ensureThumbnail(entryId: number): Promise<ThumbnailReference> {
		if (!this.#started || this.#stopping) throw new Error('File enrichment is unavailable')
		return (await this.#onDemandQueue.add(async () => {
			if (this.#stopping) throw new Error('File enrichment is unavailable')
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
					if (!candidate) throw new Error('Unsupported or missing thumbnail source')
					if (candidate.thumbnailIdentityKind === 'transient') {
						return await this.#ensureTransientThumbnail(candidate)
					}
					const content = await this.#ensureEntryContent(entryId, true, candidate)
					await this.#ensureContentThumbnail(content, true)
					return contentThumbnailReference(content.hash)
				} catch (error) {
					if (!(error instanceof StaleFileRevisionError) || attempt > 0) throw error
					const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
					if (!candidate) throw error
					await this.#onStalePath(candidate.systemPath)
				}
			}
			throw new StaleFileRevisionError('File kept changing during thumbnail generation')
		})) as ThumbnailReference
	}

	async getExistingThumbnail(entryId: number): Promise<ThumbnailReference | undefined> {
		const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!candidate) return
		if (candidate.thumbnailIdentityKind === 'transient') {
			return this.#getExistingTransientThumbnail(candidate)
		}
		const content = await this.#contentForEntry(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!content) return
		const ready = await this.#withDatabase(
			(database) =>
				Boolean(
					database
						.prepare(
							`SELECT 1 FROM thumbnail_variants
							WHERE content_id = ? AND variant = ? AND state = 'ready'`,
						)
						.get(content.id, THUMBNAIL_VARIANT),
				),
			ON_DEMAND_DATABASE_PRIORITY,
		)
		if (!ready) return

		const systemPath = thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(content.hash))
		if (!(await this.#thumbnailIsUsable(systemPath))) {
			await this.#markThumbnailPending([content.id], ON_DEMAND_DATABASE_PRIORITY)
			this.kick()
			return
		}

		return contentThumbnailReference(content.hash)
	}

	async matchesThumbnail(entryId: number, kind: string, key: string, variant: string) {
		if (variant !== THUMBNAIL_VARIANT) return false
		const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!candidate || candidate.thumbnailIdentityKind !== kind) return false
		if (kind === 'transient') {
			if (transientArtifactKey(candidate) !== key) return false
			return Boolean(await this.#getExistingTransientThumbnail(candidate))
		}
		const content = await this.#contentForEntry(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!content || content.hash !== key) return false
		return Boolean(await this.getExistingThumbnail(entryId))
	}

	async status() {
		return this.#withDatabase((database) => {
			const row = database
				.prepare(
					`SELECT
						COUNT(*) FILTER (WHERE thumbnail_identity_kind IS NOT NULL) AS eligible_entries,
						COUNT(*) FILTER (WHERE thumbnail_identity_kind = 'content' AND content_id IS NOT NULL) AS hashed_entries,
						COUNT(*) FILTER (WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL) AS pending_hashes,
						COUNT(*) FILTER (WHERE thumbnail_identity_kind = 'content' AND hash_error IS NOT NULL) AS hash_failures,
						(SELECT COUNT(*) FROM contents) AS unique_contents,
						(SELECT COUNT(*) FROM thumbnail_variants WHERE state = 'ready') +
							(SELECT COUNT(*) FROM transient_thumbnail_variants WHERE state = 'ready') AS ready_thumbnails,
						(SELECT COUNT(*) FROM thumbnail_variants WHERE state = 'failed') +
							(SELECT COUNT(*) FROM transient_thumbnail_variants WHERE state = 'failed') AS thumbnail_failures
					FROM entries`,
				)
				.get() as Record<string, number>
			return {
				eligibleEntries: Number(row.eligible_entries),
				hashedEntries: Number(row.hashed_entries),
				pendingHashes: Number(row.pending_hashes),
				hashFailures: Number(row.hash_failures),
				uniqueContents: Number(row.unique_contents),
				readyThumbnails: Number(row.ready_thumbnails),
				thumbnailFailures: Number(row.thumbnail_failures),
			}
		}, ON_DEMAND_DATABASE_PRIORITY)
	}

	async stop() {
		if (!this.#started) return
		this.#stopping = true
		this.#backgroundEnabled = false
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = undefined
		this.#wakeRequested = false
		await Promise.all([this.#backgroundQueue.onIdle(), this.#onDemandQueue.onIdle()])
		await this.#artifactFiles?.return(undefined)
		this.#artifactFiles = undefined
		this.#started = false
	}

	async #backgroundStep() {
		if (this.#stopping || this.#onDemandBusy()) {
			this.#schedule(100)
			return
		}

		// Entry triggers provide exact, transient GC hints for ordinary mutations.
		// The bounded startup sweep below remains the crash-recovery source of truth.
		const candidates = await this.#takeOrphanCandidates()
		if (candidates.processed) {
			await this.#removeOrphanedArtifacts(candidates.orphans)
			this.#schedule(0)
			return
		}
		const transientArtifacts = await this.#takeTransientArtifactCandidates()
		if (transientArtifacts.processed) {
			await this.#removeTransientArtifacts(transientArtifacts.keys)
			this.#schedule(0)
			return
		}

		const entry = await this.#nextEntryNeedingHash()
		if (entry) {
			let retryDelay = 0
			try {
				const content = await this.#ensureEntryContent(entry.id, false, entry)
				await this.#ensureContentThumbnail(content, false)
			} catch (error) {
				if (error instanceof StaleFileRevisionError) {
					await this.#onStalePath(entry.systemPath).catch((refreshError) => {
						retryDelay = INFRASTRUCTURE_RETRY_MS
						this.logger.error(`Failed to refresh stale thumbnail source '${entry.systemPath}'`, refreshError)
					})
				} else {
					if (!(error instanceof PersistedEnrichmentFailure)) retryDelay = INFRASTRUCTURE_RETRY_MS
					this.logger.error(`Failed to enrich '${entry.systemPath}'`, error)
				}
			}
			this.#schedule(retryDelay)
			return
		}

		const content = await this.#nextContentNeedingThumbnail()
		if (content) {
			let retryDelay = 0
			await this.#ensureContentThumbnail(content, false).catch(async (error) => {
				if (error instanceof StaleFileRevisionError) {
					await this.#onStalePath(content.systemPath).catch((refreshError) => {
						retryDelay = INFRASTRUCTURE_RETRY_MS
						this.logger.error(`Failed to refresh stale thumbnail source '${content.systemPath}'`, refreshError)
					})
					return
				}
				if (!(error instanceof PersistedEnrichmentFailure)) retryDelay = INFRASTRUCTURE_RETRY_MS
				this.logger.error(`Failed to generate thumbnail for '${content.systemPath}'`, error)
			})
			this.#schedule(retryDelay)
			return
		}

		// Maintenance is independent of a source file's retry schedule. In
		// particular, one unreadable file must not prevent repair or garbage
		// collection for every other content record.
		if (await this.#artifactMaintenanceStep()) {
			this.#schedule(0)
			return
		}

		const sweep = await this.#orphanSweepStep()
		if (sweep.processed) {
			await this.#removeOrphanedArtifacts(sweep.orphans)
			this.#schedule(0)
			return
		}

		const nextAttemptAt = await this.#nextAttemptAt()
		if (nextAttemptAt !== undefined) {
			this.#schedule(Math.min(IDLE_RECHECK_MS, Math.max(10, nextAttemptAt - Date.now())))
		}
	}

	#onDemandBusy() {
		return this.#onDemandQueue.pending > 0 || this.#onDemandQueue.size > 0
	}

	#schedule(delay: number) {
		if (this.#stopping || !this.#backgroundEnabled) return
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = setTimeout(() => {
			this.#timer = undefined
			this.kick()
		}, delay)
	}

	async #nextEntryNeedingHash() {
		return this.#withDatabase((database) => {
			const row = database
				.prepare(
					`SELECT entries.id, entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries INDEXED BY entries_pending_content_hash
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.thumbnail_identity_kind = 'content'
						AND entries.content_id IS NULL
						AND (entries.hash_retry_at IS NULL OR entries.hash_retry_at <= ?)
					ORDER BY entries.hash_retry_at, entries.id
					LIMIT 1`,
				)
				.get(Date.now()) as
				| {
						id: number
						device: string
						inode: string
						size: number
						modified_ns: string
						ctime_ns: string
						thumbnail_identity_kind: ThumbnailIdentityKind
						root_system_path: string
						relative_path: string
				  }
				| undefined
			if (!row) return
			return entryCandidate(row)
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #nextAttemptAt() {
		return this.#withDatabase((database) => {
			const row = database
				.prepare(
					`SELECT MIN(attempt_at) AS attempt_at FROM (
						SELECT attempt_at FROM (
							SELECT hash_retry_at AS attempt_at
							FROM entries INDEXED BY entries_pending_content_hash
							WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL
								AND hash_retry_at IS NOT NULL
							ORDER BY hash_retry_at, id LIMIT 1
						)
						UNION ALL
						SELECT attempt_at FROM (
							SELECT retry_at AS attempt_at
							FROM thumbnail_variants AS failed INDEXED BY thumbnail_variants_failed_work
							WHERE variant = ? AND state = 'failed'
								AND EXISTS (SELECT 1 FROM entries WHERE entries.content_id = failed.content_id)
							ORDER BY retry_at, content_id LIMIT 1
						)
						UNION ALL
						SELECT MIN(deferred_at + ?) AS attempt_at
						FROM content_gc_candidates
					)`,
				)
				.get(THUMBNAIL_VARIANT, this.#orphanGcMaxDeferralMs) as {attempt_at: number | null}
			return row.attempt_at === null ? undefined : Number(row.attempt_at)
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #ensureEntryContent(entryId: number, onDemand: boolean, knownCandidate?: EntryCandidate) {
		const priority = onDemand ? ON_DEMAND_DATABASE_PRIORITY : BACKGROUND_DATABASE_PRIORITY
		const ready = await this.#contentForEntry(entryId, priority)
		if (ready) return ready
		const candidate = knownCandidate ?? (await this.#entryCandidate(entryId, priority))
		if (!candidate) throw new Error('Unsupported or missing thumbnail source')

		let hash: Buffer
		try {
			hash = await this.#hashFile(candidate.systemPath, candidate)
		} catch (error) {
			if (error instanceof StaleFileRevisionError) throw error
			await this.#recordHashFailure(candidate, error, priority)
			throw new PersistedEnrichmentFailure(error)
		}

		return this.#withDatabase((database) => {
			const attach = database.transaction(() => {
				database
					.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, ?, ?) ON CONFLICT(blake3) DO NOTHING')
					.run(hash, candidate.size, Date.now())
				const content = database.prepare('SELECT id, hex(blake3) AS hash FROM contents WHERE blake3 = ?').get(hash) as {
					id: number
					hash: string
				}
				database
					.prepare(
						`INSERT INTO thumbnail_variants(content_id, variant, state, failure_count, updated_at)
						VALUES (?, ?, 'pending', 0, ?)
						ON CONFLICT(content_id, variant) DO NOTHING`,
					)
					.run(content.id, THUMBNAIL_VARIANT, Date.now())
				const result = database
					.prepare(
						`UPDATE entries SET
							content_id = ?,
							hash_failure_count = 0, hash_retry_at = NULL, hash_error = NULL
						WHERE id = ? AND thumbnail_identity_kind = 'content' AND content_id IS NULL
							AND inode = ? AND size = ? AND modified_ns = ? AND ctime_ns = ?`,
					)
					.run(content.id, candidate.id, candidate.inode, candidate.size, candidate.modifiedNs, candidate.ctimeNs)
				if (result.changes === 0) throw new StaleFileRevisionError('File changed while hashing')
				return {
					...content,
					entryId: candidate.id,
					hash: content.hash.toLowerCase(),
					systemPath: candidate.systemPath,
					fingerprint: candidate,
				}
			})
			return attach.immediate()
		}, priority)
	}

	async #recordHashFailure(candidate: EntryCandidate, error: unknown, priority: number) {
		await this.#withDatabase((database) => {
			const current = database.prepare('SELECT hash_failure_count FROM entries WHERE id = ?').get(candidate.id) as
				| {hash_failure_count: number}
				| undefined
			if (!current) return
			const failureCount = Number(current.hash_failure_count) + 1
			database
				.prepare(
					`UPDATE entries SET hash_failure_count = ?, hash_retry_at = ?, hash_error = ?
					WHERE id = ? AND thumbnail_identity_kind = 'content'
						AND inode = ? AND size = ? AND modified_ns = ? AND ctime_ns = ?`,
				)
				.run(
					failureCount,
					Date.now() + retryDelay(HASH_RETRY_BASE_MS, failureCount),
					errorMessage(error),
					candidate.id,
					candidate.inode,
					candidate.size,
					candidate.modifiedNs,
					candidate.ctimeNs,
				)
		}, priority)
	}

	async #nextContentNeedingThumbnail() {
		return this.#withDatabase((database) => {
			const select = (state: 'pending' | 'failed') => {
				const workIndex = state === 'pending' ? 'thumbnail_variants_pending_work' : 'thumbnail_variants_failed_work'
				const retryPredicate = state === 'pending' ? '' : 'AND thumbnail_variants.retry_at <= ?'
				const workOrder =
					state === 'pending'
						? 'thumbnail_variants.content_id, entries.id'
						: 'thumbnail_variants.retry_at, thumbnail_variants.content_id, entries.id'
				return database
					.prepare(
						`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
						entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM thumbnail_variants INDEXED BY ${workIndex}
					JOIN contents ON contents.id = thumbnail_variants.content_id
					JOIN entries INDEXED BY entries_by_content ON entries.content_id = thumbnail_variants.content_id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE thumbnail_variants.variant = ? AND thumbnail_variants.state = '${state}'
						${retryPredicate}
					ORDER BY ${workOrder}
					LIMIT 1`,
					)
					.get(THUMBNAIL_VARIANT, ...(state === 'failed' ? [Date.now()] : [])) as ContentCandidateRow | undefined
			}
			const row = select('pending') ?? select('failed')
			return row ? contentCandidate(row) : undefined
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #ensureContentThumbnail(content: ContentCandidate, onDemand: boolean) {
		const priority = onDemand ? ON_DEMAND_DATABASE_PRIORITY : BACKGROUND_DATABASE_PRIORITY
		const identity = contentIdentity(content.hash)
		await this.#withArtifactOperation(identity, async () => {
			const destination = thumbnailSystemPath(this.thumbnailDirectory, identity)
			const existing = await this.#withDatabase(
				(database) =>
					database
						.prepare('SELECT state, retry_at FROM thumbnail_variants WHERE content_id = ? AND variant = ?')
						.get(content.id, THUMBNAIL_VARIANT) as
						| {state: 'pending' | 'ready' | 'failed'; retry_at: number | null}
						| undefined,
				priority,
			)
			if (existing?.state === 'ready' && (await this.#thumbnailIsUsable(destination))) return
			if (!onDemand && existing?.state === 'failed' && existing.retry_at !== null && existing.retry_at > Date.now()) {
				return
			}

			const attemptedEntries = new Set<number>()
			while (true) {
				attemptedEntries.add(content.entryId)
				const temporary = `${destination}.tmp-${randomUUID()}.${THUMBNAIL_FORMAT}`
				try {
					await this.#ensureArtifactDirectory(nodePath.dirname(destination))
					await assertContentRevision(content.systemPath, content.fingerprint)
					if (!(await this.#thumbnailIsUsable(destination))) {
						await this.#remove(destination).catch(() => {})
						await this.#generateThumbnail(content.systemPath, temporary)
						await assertContentRevision(content.systemPath, content.fingerprint)
						await syncThumbnailArtifact(temporary)
						await fse.move(temporary, destination, {overwrite: false}).catch(async (error) => {
							if (!(await this.#thumbnailIsUsable(destination))) throw error
							await this.#remove(temporary).catch(() => {})
						})
						await syncThumbnailArtifact(destination)
						await syncDirectory(nodePath.dirname(destination))
					}
					await this.#markThumbnailReady(content, priority)
					return
				} catch (error) {
					await this.#remove(temporary).catch(() => {})
					const referenceFailure = await contentReferenceFailure(error, content)
					if (referenceFailure) {
						if (referenceFailure === 'stale') {
							await this.#onStalePath(content.systemPath).catch((refreshError) =>
								this.logger.error(`Failed to refresh stale thumbnail source '${content.systemPath}'`, refreshError),
							)
						}
						const alternative = await this.#nextContentReference(content.id, attemptedEntries, priority)
						if (alternative) {
							content = alternative
							continue
						}
						if (referenceFailure === 'stale') {
							throw new StaleFileRevisionError('No current source remains for thumbnail content', {cause: error})
						}
					}
					await this.#recordThumbnailFailure(content.id, error, priority)
					throw new PersistedEnrichmentFailure(error)
				}
			}
		})
	}

	async #markThumbnailReady(content: ContentCandidate, priority: number) {
		await this.#withDatabase((database) => {
			const current = database
				.prepare(
					`SELECT 1 FROM entries
					WHERE content_id = ? AND thumbnail_identity_kind = 'content'
						AND inode = ? AND size = ? AND modified_ns = ? AND ctime_ns = ?`,
				)
				.get(
					content.id,
					content.fingerprint.inode,
					content.fingerprint.size,
					content.fingerprint.modifiedNs,
					content.fingerprint.ctimeNs,
				)
			if (!current) throw new StaleFileRevisionError('File changed while generating thumbnail')
			database
				.prepare(
					`INSERT INTO thumbnail_variants(
						content_id, variant, state, failure_count, retry_at, last_error, created_at, updated_at
					) VALUES (?, ?, 'ready', 0, NULL, NULL, ?, ?)
					ON CONFLICT(content_id, variant) DO UPDATE SET
						state = 'ready', failure_count = 0, retry_at = NULL,
						last_error = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
				)
				.run(content.id, THUMBNAIL_VARIANT, Date.now(), Date.now())
		}, priority)
	}

	async #ensureTransientThumbnail(candidate: EntryCandidate): Promise<ThumbnailReference> {
		const identity = transientIdentity(candidate)
		await this.#withArtifactOperation(identity, async () => {
			const destination = thumbnailSystemPath(this.thumbnailDirectory, identity)
			const existing = await this.#withDatabase(
				(database) =>
					database
						.prepare(
							`SELECT artifact_key, state FROM transient_thumbnail_variants
							WHERE entry_id = ? AND variant = ?`,
						)
						.get(candidate.id, THUMBNAIL_VARIANT) as
						| {artifact_key: string; state: 'pending' | 'ready' | 'failed'}
						| undefined,
				ON_DEMAND_DATABASE_PRIORITY,
			)
			if (
				existing?.artifact_key === identity.key &&
				existing.state === 'ready' &&
				(await this.#thumbnailIsUsable(destination))
			) {
				return
			}

			const temporary = `${destination}.tmp-${randomUUID()}.${THUMBNAIL_FORMAT}`
			try {
				await this.#ensureArtifactDirectory(nodePath.dirname(destination))
				await assertTransientRevision(candidate.systemPath, candidate)
				if (!(await this.#thumbnailIsUsable(destination))) {
					await this.#remove(destination).catch(() => {})
					await this.#generateThumbnail(candidate.systemPath, temporary)
					await assertTransientRevision(candidate.systemPath, candidate)
					await syncThumbnailArtifact(temporary)
					await fse.move(temporary, destination, {overwrite: false}).catch(async (error) => {
						if (!(await this.#thumbnailIsUsable(destination))) throw error
						await this.#remove(temporary).catch(() => {})
					})
					await syncThumbnailArtifact(destination)
					await syncDirectory(nodePath.dirname(destination))
				}
				await this.#markTransientThumbnailReady(candidate, identity.key)
			} catch (error) {
				await this.#remove(temporary).catch(() => {})
				if (error instanceof StaleFileRevisionError) throw error
				await this.#recordTransientThumbnailFailure(candidate, identity.key, error)
				throw new PersistedEnrichmentFailure(error)
			}
		})
		return transientThumbnailReference(transientArtifactKey(candidate))
	}

	async #getExistingTransientThumbnail(candidate: EntryCandidate): Promise<ThumbnailReference | undefined> {
		const identity = transientIdentity(candidate)
		const ready = await this.#withDatabase(
			(database) =>
				Boolean(
					database
						.prepare(
							`SELECT 1 FROM transient_thumbnail_variants
							WHERE entry_id = ? AND variant = ? AND artifact_key = ? AND state = 'ready'`,
						)
						.get(candidate.id, THUMBNAIL_VARIANT, identity.key),
				),
			ON_DEMAND_DATABASE_PRIORITY,
		)
		if (!ready) return
		if (!(await this.#thumbnailIsUsable(thumbnailSystemPath(this.thumbnailDirectory, identity)))) {
			await this.#withDatabase(
				(database) =>
					database
						.prepare(
							`UPDATE transient_thumbnail_variants SET state = 'pending', updated_at = ?
							WHERE entry_id = ? AND variant = ? AND artifact_key = ?`,
						)
						.run(Date.now(), candidate.id, THUMBNAIL_VARIANT, identity.key),
				ON_DEMAND_DATABASE_PRIORITY,
			)
			return
		}
		return transientThumbnailReference(identity.key)
	}

	async #markTransientThumbnailReady(candidate: EntryCandidate, artifactKey: string) {
		await this.#withDatabase((database) => {
			const publish = database.transaction(() => {
				const current = database
					.prepare(
						`SELECT 1 FROM entries
						WHERE id = ? AND thumbnail_identity_kind = 'transient'
							AND device = ? AND inode = ? AND size = ? AND modified_ns = ?`,
					)
					.get(candidate.id, candidate.device, candidate.inode, candidate.size, candidate.modifiedNs)
				if (!current) throw new StaleFileRevisionError('File changed while generating thumbnail')
				database
					.prepare(
						`INSERT INTO transient_thumbnail_variants(
							entry_id, variant, artifact_key, state, failure_count, last_error, created_at, updated_at
						) VALUES (?, ?, ?, 'ready', 0, NULL, ?, ?)
						ON CONFLICT(entry_id, variant) DO UPDATE SET
							artifact_key = excluded.artifact_key, state = 'ready', failure_count = 0,
							last_error = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
					)
					.run(candidate.id, THUMBNAIL_VARIANT, artifactKey, Date.now(), Date.now())
			})
			publish.immediate()
		}, ON_DEMAND_DATABASE_PRIORITY)
	}

	async #recordTransientThumbnailFailure(candidate: EntryCandidate, artifactKey: string, error: unknown) {
		await this.#withDatabase((database) => {
			const record = database.transaction(() => {
				const current = database
					.prepare(
						`SELECT 1 FROM entries
						WHERE id = ? AND thumbnail_identity_kind = 'transient'
							AND device = ? AND inode = ? AND size = ? AND modified_ns = ?`,
					)
					.get(candidate.id, candidate.device, candidate.inode, candidate.size, candidate.modifiedNs)
				if (!current) throw new StaleFileRevisionError('File changed while generating thumbnail')
				const existing = database
					.prepare(
						`SELECT failure_count FROM transient_thumbnail_variants
						WHERE entry_id = ? AND variant = ? AND artifact_key = ?`,
					)
					.get(candidate.id, THUMBNAIL_VARIANT, artifactKey) as {failure_count: number} | undefined
				database
					.prepare(
						`INSERT INTO transient_thumbnail_variants(
							entry_id, variant, artifact_key, state, failure_count, last_error, updated_at
						) VALUES (?, ?, ?, 'failed', ?, ?, ?)
						ON CONFLICT(entry_id, variant) DO UPDATE SET
							artifact_key = excluded.artifact_key, state = 'failed',
							failure_count = excluded.failure_count, last_error = excluded.last_error,
							updated_at = excluded.updated_at`,
					)
					.run(
						candidate.id,
						THUMBNAIL_VARIANT,
						artifactKey,
						Number(existing?.failure_count ?? 0) + 1,
						errorMessage(error),
						Date.now(),
					)
			})
			record.immediate()
		}, ON_DEMAND_DATABASE_PRIORITY)
	}

	async #ensureArtifactDirectory(systemPath: string): Promise<void> {
		const pending = this.#directoryPublication.get(systemPath)
		if (pending) return pending

		const publication = (async () => {
			const parent = nodePath.dirname(systemPath)
			if (systemPath !== this.thumbnailDirectory) await this.#ensureArtifactDirectory(parent)

			let created = false
			try {
				await mkdir(systemPath)
				created = true
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
				const stats = await fse.lstat(systemPath)
				if (!stats.isDirectory()) throw error
			}

			// Persist the directory entry before any lane can publish a ready
			// artifact below it. Syncing only the leaf after the file rename does
			// not make newly-created shard ancestors durable across a power cut.
			if (created) await syncDirectory(parent)
		})()
		this.#directoryPublication.set(systemPath, publication)
		try {
			await publication
		} finally {
			if (this.#directoryPublication.get(systemPath) === publication) this.#directoryPublication.delete(systemPath)
		}
	}

	async #withArtifactOperation<T>(identity: ThumbnailIdentity, operation: () => Promise<T>): Promise<T> {
		const key = `${identity.kind}:${identity.key}`
		const previous = this.#artifactOperations.get(key) ?? Promise.resolve()
		let release!: () => void
		const turn = new Promise<void>((resolve) => (release = resolve))
		const tail = previous.catch(() => {}).then(() => turn)
		this.#artifactOperations.set(key, tail)
		await previous.catch(() => {})
		try {
			return await operation()
		} finally {
			release()
			if (this.#artifactOperations.get(key) === tail) this.#artifactOperations.delete(key)
		}
	}

	async #nextContentReference(contentId: number, excludedEntryIds: Set<number>, priority: number) {
		return this.#withDatabase((database) => {
			const excluded = [...excludedEntryIds]
			const placeholders = excluded.map(() => '?').join(', ')
			const row = database
				.prepare(
					`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
						entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries INDEXED BY entries_by_content
					JOIN contents ON contents.id = entries.content_id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.content_id = ? AND entries.thumbnail_identity_kind = 'content'
						AND entries.id NOT IN (${placeholders})
					ORDER BY entries.id LIMIT 1`,
				)
				.get(contentId, ...excluded) as ContentCandidateRow | undefined
			return row ? contentCandidate(row) : undefined
		}, priority)
	}

	async #recordThumbnailFailure(contentId: number, error: unknown, priority: number) {
		await this.#withDatabase((database) => {
			const existing = database
				.prepare('SELECT failure_count FROM thumbnail_variants WHERE content_id = ? AND variant = ?')
				.get(contentId, THUMBNAIL_VARIANT) as {failure_count: number} | undefined
			const failureCount = Number(existing?.failure_count ?? 0) + 1
			database
				.prepare(
					`INSERT INTO thumbnail_variants(
						content_id, variant, state, failure_count, retry_at, last_error, updated_at
					) VALUES (?, ?, 'failed', ?, ?, ?, ?)
					ON CONFLICT(content_id, variant) DO UPDATE SET
						state = 'failed', failure_count = excluded.failure_count,
						retry_at = excluded.retry_at, last_error = excluded.last_error,
						updated_at = excluded.updated_at`,
				)
				.run(
					contentId,
					THUMBNAIL_VARIANT,
					failureCount,
					Date.now() + retryDelay(THUMBNAIL_RETRY_BASE_MS, failureCount),
					errorMessage(error),
					Date.now(),
				)
		}, priority)
	}

	async #entryCandidate(entryId: number, priority: number) {
		return this.#withDatabase((database) => {
			const row = database
				.prepare(
					`SELECT entries.id, entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.id = ? AND entries.thumbnail_identity_kind IS NOT NULL`,
				)
				.get(entryId) as EntryCandidateRow | undefined
			return row ? entryCandidate(row) : undefined
		}, priority)
	}

	async #contentForEntry(entryId: number, priority: number) {
		return this.#withDatabase((database) => {
			const row = database
				.prepare(
					`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
						entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries
					JOIN contents ON contents.id = entries.content_id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.id = ? AND entries.thumbnail_identity_kind = 'content'`,
				)
				.get(entryId) as ContentCandidateRow | undefined
			return row ? contentCandidate(row) : undefined
		}, priority)
	}

	async #takeOrphanCandidates(): Promise<OrphanMaintenance> {
		return this.#withDatabase((database) => {
			const remove = database.transaction(() => {
				const pendingHash = database
					.prepare(
						`SELECT 1 FROM entries INDEXED BY entries_pending_content_hash
						WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL AND hash_error IS NULL
						LIMIT 1`,
					)
					.get()
				const candidates = database
					.prepare(
						`SELECT content_id FROM content_gc_candidates
						WHERE ? = 0 OR deferred_at <= ?
						ORDER BY content_id LIMIT ?`,
					)
					.all(
						Number(Boolean(pendingHash)),
						Date.now() - this.#orphanGcMaxDeferralMs,
						ORPHAN_SWEEP_BATCH_SIZE,
					) as Array<{
					content_id: number
				}>
				if (candidates.length === 0) return {processed: false, orphans: []}

				const ids = candidates.map(({content_id}) => Number(content_id))
				const placeholders = ids.map(() => '?').join(', ')
				database.prepare(`DELETE FROM content_gc_candidates WHERE content_id IN (${placeholders})`).run(...ids)
				const orphans = database
					.prepare(
						`SELECT id, hex(blake3) AS hash FROM contents
						WHERE id IN (${placeholders})
							AND NOT EXISTS (SELECT 1 FROM entries WHERE entries.content_id = contents.id)`,
					)
					.all(...ids) as OrphanedContentRow[]
				if (orphans.length > 0) {
					const orphanIds = orphans.map(({id}) => Number(id))
					const orphanPlaceholders = orphanIds.map(() => '?').join(', ')
					database
						.prepare(
							`DELETE FROM contents WHERE id IN (${orphanPlaceholders})
								AND NOT EXISTS (SELECT 1 FROM entries WHERE entries.content_id = contents.id)`,
						)
						.run(...orphanIds)
				}
				return {
					processed: true,
					orphans: orphans.map(({id, hash}) => ({id: Number(id), key: hash.toLowerCase()})),
				}
			})
			return remove.immediate()
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #orphanSweepStep(): Promise<OrphanMaintenance> {
		if (this.#orphanSweepCursor === undefined) return {processed: false, orphans: []}
		const afterContentId = this.#orphanSweepCursor
		const result = await this.#withDatabase((database) => {
			const sweep = database.transaction(() => {
				const rows = database
					.prepare(
						`SELECT id, hex(blake3) AS hash,
							NOT EXISTS (SELECT 1 FROM entries WHERE entries.content_id = contents.id) AS orphaned
						FROM contents WHERE id > ? ORDER BY id LIMIT ?`,
					)
					.all(afterContentId, ORPHAN_SWEEP_BATCH_SIZE) as Array<OrphanedContentRow & {orphaned: number}>
				const orphans = rows.filter(({orphaned}) => Boolean(orphaned))
				const defer = database.prepare(
					`INSERT INTO content_gc_candidates(content_id, deferred_at) VALUES (?, ?)
					ON CONFLICT(content_id) DO NOTHING`,
				)
				for (const {id} of orphans) defer.run(id, Date.now())
				return {
					rows: rows.length,
					lastId: rows.at(-1)?.id,
				}
			})
			return sweep.immediate()
		}, BACKGROUND_DATABASE_PRIORITY)

		if (result.lastId !== undefined) this.#orphanSweepCursor = Number(result.lastId)
		if (result.rows < ORPHAN_SWEEP_BATCH_SIZE) this.#orphanSweepCursor = undefined
		return {processed: result.rows > 0, orphans: []}
	}

	async #removeOrphanedArtifacts(orphans: OrphanedContent[]) {
		await inConcurrentChunks(orphans, ARTIFACT_IO_CONCURRENCY, async (orphan) => {
			const identity = contentIdentity(orphan.key)
			await this.#withArtifactOperation(identity, async () => {
				if ((await this.#trackedContentHashes([orphan.key])).has(orphan.key)) return
				await this.#remove(thumbnailSystemPath(this.thumbnailDirectory, identity)).catch((error) =>
					this.logger.error(`Failed to remove orphaned thumbnail '${orphan.key}'`, error),
				)
			})
		})
	}

	async #takeTransientArtifactCandidates(): Promise<{processed: boolean; keys: string[]}> {
		return this.#withDatabase((database) => {
			const take = database.transaction(() => {
				const rows = database
					.prepare(
						`SELECT artifact_key FROM transient_artifact_gc_candidates
						ORDER BY artifact_key LIMIT ?`,
					)
					.all(ORPHAN_SWEEP_BATCH_SIZE) as Array<{artifact_key: string}>
				if (rows.length === 0) return {processed: false, keys: []}
				const keys = rows.map(({artifact_key}) => artifact_key)
				const placeholders = keys.map(() => '?').join(', ')
				database
					.prepare(`DELETE FROM transient_artifact_gc_candidates WHERE artifact_key IN (${placeholders})`)
					.run(...keys)
				const tracked = new Set(
					(
						database
							.prepare(
								`SELECT DISTINCT artifact_key FROM transient_thumbnail_variants
								WHERE variant = ? AND artifact_key IN (${placeholders})`,
							)
							.all(THUMBNAIL_VARIANT, ...keys) as Array<{artifact_key: string}>
					).map(({artifact_key}) => artifact_key),
				)
				return {processed: true, keys: keys.filter((key) => !tracked.has(key))}
			})
			return take.immediate()
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #removeTransientArtifacts(keys: string[]) {
		await inConcurrentChunks(keys, ARTIFACT_IO_CONCURRENCY, async (key) => {
			const identity: ThumbnailIdentity = {kind: 'transient', key}
			await this.#withArtifactOperation(identity, async () => {
				if ((await this.#trackedTransientArtifactKeys([key])).has(key)) return
				await this.#remove(thumbnailSystemPath(this.thumbnailDirectory, identity)).catch((error) =>
					this.logger.error(`Failed to remove unused transient thumbnail '${key}'`, error),
				)
			})
		})
	}

	async #artifactMaintenanceStep() {
		if (
			this.#thumbnailVerificationCursor !== undefined ||
			Date.now() - this.#thumbnailVerificationCompletedAt >= ARTIFACT_MAINTENANCE_INTERVAL_MS
		) {
			if (this.#thumbnailVerificationCursor === undefined) this.#thumbnailVerificationCursor = 0
			const ready = await this.#nextReadyThumbnails(this.#thumbnailVerificationCursor)
			if (ready.length > 0) {
				this.#thumbnailVerificationCursor = ready.at(-1)!.contentId
				const missing: number[] = []
				await inConcurrentChunks(ready, ARTIFACT_IO_CONCURRENCY, async (thumbnail) => {
					if (
						!(await this.#thumbnailIsUsable(
							thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(thumbnail.key)),
						))
					) {
						missing.push(thumbnail.contentId)
					}
				})
				await this.#markThumbnailPending(missing, BACKGROUND_DATABASE_PRIORITY)
				return true
			}
			this.#thumbnailVerificationCursor = undefined
			this.#thumbnailVerificationCompletedAt = Date.now()
			return true
		}

		if (!this.#destructiveArtifactMaintenanceAllowed) return false
		// A rebuilt database knows paths before the enrichment lane has had time
		// to reconnect their content hashes. Do not classify artifacts as
		// untracked during that gap (the same invariant also protects live moves).
		if (this.#artifactFiles && (await this.#hasUnsettledContentHashes())) return false
		if (!this.#artifactFiles && Date.now() - this.#artifactMaintenanceCompletedAt < ARTIFACT_MAINTENANCE_INTERVAL_MS) {
			return false
		}

		if (this.#artifactFiles) {
			const paths: string[] = []
			let complete = false
			while (paths.length < ARTIFACT_MAINTENANCE_BATCH_SIZE) {
				const next = await this.#artifactFiles.next()
				if (next.done) {
					this.#artifactFiles = undefined
					this.#artifactMaintenanceCompletedAt = Date.now()
					complete = true
					break
				}
				paths.push(next.value)
			}

			const artifacts = paths.map((systemPath) => ({
				systemPath,
				identity: storedThumbnailIdentity(this.thumbnailDirectory, systemPath),
			}))
			await inConcurrentChunks(artifacts, ARTIFACT_IO_CONCURRENCY, async ({systemPath, identity}) => {
				if (identity) {
					await this.#withArtifactOperation(identity, async () => {
						if (await this.#thumbnailIdentityIsTracked(identity)) return
						if (await isRecentTemporaryArtifact(systemPath)) return
						await this.#remove(systemPath).catch((error) =>
							this.logger.error(`Failed to remove untracked thumbnail artifact '${systemPath}'`, error),
						)
					})
					return
				}
				if (await isRecentTemporaryArtifact(systemPath)) return
				await this.#remove(systemPath).catch((error) =>
					this.logger.error(`Failed to remove untracked thumbnail artifact '${systemPath}'`, error),
				)
			})
			return paths.length > 0 || !complete
		}
		if (await this.#hasUnsettledContentHashes()) return false
		this.#artifactFiles = walkArtifactFiles(this.thumbnailDirectory, this.logger)
		return true
	}

	async #hasUnsettledContentHashes() {
		return this.#withDatabase(
			(database) =>
				Boolean(
					database
						.prepare(
							`SELECT 1 FROM entries INDEXED BY entries_pending_content_hash
							WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL AND hash_error IS NULL
							LIMIT 1`,
						)
						.get(),
				),
			BACKGROUND_DATABASE_PRIORITY,
		)
	}

	async #nextReadyThumbnails(afterContentId: number) {
		return this.#withDatabase((database) => {
			const rows = database
				.prepare(
					`SELECT thumbnail_variants.content_id, hex(contents.blake3) AS hash
					FROM thumbnail_variants
					JOIN contents ON contents.id = thumbnail_variants.content_id
					WHERE thumbnail_variants.variant = ? AND thumbnail_variants.state = 'ready'
						AND thumbnail_variants.content_id > ?
					ORDER BY thumbnail_variants.content_id
					LIMIT ?`,
				)
				.all(THUMBNAIL_VARIANT, afterContentId, ARTIFACT_MAINTENANCE_BATCH_SIZE) as Array<{
				content_id: number
				hash: string
			}>
			return rows.map(
				(row) => ({contentId: Number(row.content_id), key: row.hash.toLowerCase()}) satisfies ReadyThumbnail,
			)
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #markThumbnailPending(contentIds: number[], priority: number) {
		if (contentIds.length === 0) return
		await this.#withDatabase((database) => {
			const placeholders = contentIds.map(() => '?').join(', ')
			database
				.prepare(
					`UPDATE thumbnail_variants SET
						state = 'pending', failure_count = 0, retry_at = NULL,
						last_error = NULL, created_at = NULL, updated_at = ?
					WHERE variant = ? AND content_id IN (${placeholders})`,
				)
				.run(Date.now(), THUMBNAIL_VARIANT, ...contentIds)
		}, priority)
	}

	async #trackedContentHashes(hashes: string[]) {
		if (hashes.length === 0) return new Set<string>()
		return this.#withDatabase((database) => {
			const unique = [...new Set(hashes)]
			const placeholders = unique.map(() => '?').join(', ')
			const rows = database
				.prepare(
					`SELECT hex(blake3) AS hash FROM contents
					WHERE blake3 IN (${placeholders})`,
				)
				.all(...unique.map((hash) => Buffer.from(hash, 'hex'))) as Array<{hash: string}>
			return new Set(rows.map(({hash}) => hash.toLowerCase()))
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #trackedTransientArtifactKeys(keys: string[]) {
		if (keys.length === 0) return new Set<string>()
		return this.#withDatabase((database) => {
			const unique = [...new Set(keys)]
			const placeholders = unique.map(() => '?').join(', ')
			const rows = database
				.prepare(
					`SELECT DISTINCT artifact_key FROM transient_thumbnail_variants
					WHERE variant = ? AND artifact_key IN (${placeholders})`,
				)
				.all(THUMBNAIL_VARIANT, ...unique) as Array<{artifact_key: string}>
			return new Set(rows.map(({artifact_key}) => artifact_key))
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #thumbnailIdentityIsTracked(identity: ThumbnailIdentity) {
		return identity.kind === 'content'
			? (await this.#trackedContentHashes([identity.key])).has(identity.key)
			: (await this.#trackedTransientArtifactKeys([identity.key])).has(identity.key)
	}
}

type EntryCandidateRow = {
	id: number
	device: string
	inode: string
	size: number
	modified_ns: string
	ctime_ns: string
	thumbnail_identity_kind: ThumbnailIdentityKind
	root_system_path: string
	relative_path: string
}

type ContentCandidateRow = Omit<EntryCandidateRow, 'id'> & {id: number; entry_id: number; hash: string}

function entryCandidate(row: EntryCandidateRow): EntryCandidate {
	return {
		id: Number(row.id),
		device: row.device,
		inode: row.inode,
		size: Number(row.size),
		modifiedNs: row.modified_ns,
		ctimeNs: row.ctime_ns,
		thumbnailIdentityKind: row.thumbnail_identity_kind,
		systemPath: nodePath.join(row.root_system_path, ...row.relative_path.split('/')),
	}
}

function contentCandidate(row: ContentCandidateRow): ContentCandidate {
	return {
		id: Number(row.id),
		entryId: Number(row.entry_id),
		hash: row.hash.toLowerCase(),
		systemPath: nodePath.join(row.root_system_path, ...row.relative_path.split('/')),
		fingerprint: {
			inode: row.inode,
			size: Number(row.size),
			modifiedNs: row.modified_ns,
			ctimeNs: row.ctime_ns,
		},
	}
}

export async function hashFileRevision(systemPath: string, expected: ContentFingerprint) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		await assertHandleContentRevision(handle, expected)
		const hasher = new Blake3Hasher()
		for await (const chunk of handle.createReadStream({autoClose: false, highWaterMark: 1024 * 1024})) {
			hasher.update(chunk)
		}
		await assertHandleContentRevision(handle, expected)
		return hasher.digestBuffer()
	} finally {
		await handle.close()
	}
}

async function assertContentRevision(systemPath: string, expected: ContentFingerprint) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		await assertHandleContentRevision(handle, expected)
	} finally {
		await handle.close()
	}
}

async function assertHandleContentRevision(handle: Awaited<ReturnType<typeof open>>, expected: ContentFingerprint) {
	const stats = await handle.stat({bigint: true})
	if (
		!stats.isFile() ||
		stats.ino.toString() !== expected.inode ||
		Number(stats.size) !== expected.size ||
		stats.mtimeNs.toString() !== expected.modifiedNs ||
		stats.ctimeNs.toString() !== expected.ctimeNs
	) {
		throw new StaleFileRevisionError('File revision no longer matches the index')
	}
}

async function assertTransientRevision(systemPath: string, expected: EntryCandidate) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		const stats = await handle.stat({bigint: true})
		if (
			!stats.isFile() ||
			stats.dev.toString() !== expected.device ||
			stats.ino.toString() !== expected.inode ||
			Number(stats.size) !== expected.size ||
			stats.mtimeNs.toString() !== expected.modifiedNs
		) {
			throw new StaleFileRevisionError('File revision no longer matches the index')
		}
	} finally {
		await handle.close()
	}
}

async function contentReferenceFailure(error: unknown, content: ContentCandidate) {
	// Only our revision guard can classify the original error as stale. An
	// artifact-side ENOENT/EIO can otherwise look exactly like a missing source
	// and would be retried immediately without recording backoff.
	if (error instanceof StaleFileRevisionError) return 'stale'
	try {
		await assertContentRevision(content.systemPath, content.fingerprint)
	} catch (revisionError) {
		return referenceFailureKind(revisionError)
	}
}

function referenceFailureKind(error: unknown): 'stale' | 'unreadable' | undefined {
	if (error instanceof StaleFileRevisionError) return 'stale'
	const code = (error as NodeJS.ErrnoException | undefined)?.code
	if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ESTALE') return 'stale'
	if (code === 'EACCES' || code === 'EPERM' || code === 'EIO') return 'unreadable'
}

export async function generateThumbnailFile(systemPath: string, destination: string) {
	const conversion = execa(
		'convert',
		[
			'-limit',
			'memory',
			String(THUMBNAIL_MEMORY_LIMIT_BYTES),
			'-limit',
			'map',
			String(THUMBNAIL_MAP_LIMIT_BYTES),
			'-limit',
			'disk',
			String(THUMBNAIL_DISK_LIMIT_BYTES),
			'-limit',
			'thread',
			String(THUMBNAIL_THREAD_LIMIT),
			'-limit',
			'time',
			String(Math.ceil(THUMBNAIL_GENERATION_TIMEOUT_MS / 1000)),
			`${escapeImageMagickInputPath(systemPath)}[0]`,
			'-auto-orient',
			'-resize',
			`${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}`,
			'-quality',
			String(THUMBNAIL_QUALITY),
			`${THUMBNAIL_FORMAT}:${destination}`,
		],
		{detached: true, timeout: THUMBNAIL_GENERATION_TIMEOUT_MS, killSignal: 'SIGKILL'},
	)
	try {
		await conversion
	} catch (error) {
		if ((error as {timedOut?: boolean}).timedOut && conversion.pid !== undefined) {
			killProcessGroup(conversion.pid)
		}
		throw error
	}
}

function escapeImageMagickInputPath(systemPath: string) {
	// ImageMagick expands these characters itself even though execa bypasses the
	// shell. Escape only the subprocess argument; the real filesystem path and
	// the intentional first-frame selector appended by the caller stay unchanged.
	// Backslashes are legal Linux filename characters and are preserved unless
	// they precede a glob character. In that case ImageMagick needs 2n+1
	// backslashes to represent n literal backslashes followed by an escaped glob.
	let escaped = ''
	let backslashes = 0
	for (const character of systemPath) {
		if (character === '\\') {
			backslashes++
			continue
		}
		if (character === '*' || character === '?' || character === '[' || character === ']') {
			escaped += `${'\\'.repeat(2 * backslashes + 1)}${character}`
		} else {
			escaped += `${'\\'.repeat(backslashes)}${character === '%' ? '%%' : character}`
		}
		backslashes = 0
	}
	return escaped + '\\'.repeat(backslashes)
}

function killProcessGroup(pid: number) {
	try {
		process.kill(-pid, 'SIGKILL')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
	}
}

async function thumbnailArtifactIsUsable(systemPath: string) {
	let handle: Awaited<ReturnType<typeof open>>
	try {
		handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return false
		throw error
	}
	try {
		const stats = await handle.stat()
		return stats.isFile() && stats.size > 0
	} finally {
		await handle.close()
	}
}

async function syncThumbnailArtifact(systemPath: string) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
	try {
		const stats = await handle.stat()
		if (!stats.isFile() || stats.size === 0)
			throw new Error('Thumbnail generator produced an empty or invalid artifact')
		await handle.sync()
	} finally {
		await handle.close()
	}
}

async function syncDirectory(systemPath: string) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY)
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

function retryDelay(base: number, failureCount: number) {
	return Math.min(base * 2 ** Math.max(0, failureCount - 1), MAX_RETRY_MS)
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function contentIdentity(key: string): ThumbnailIdentity {
	return {kind: 'content', key}
}

function transientArtifactKey(candidate: EntryCandidate) {
	return createHash('sha256')
		.update(
			JSON.stringify([
				'transient-thumbnail-v1',
				candidate.device,
				candidate.inode,
				candidate.size,
				candidate.modifiedNs,
			]),
		)
		.digest('hex')
}

function transientIdentity(candidate: EntryCandidate): ThumbnailIdentity {
	return {kind: 'transient', key: transientArtifactKey(candidate)}
}

function contentThumbnailReference(key: string): ThumbnailReference {
	return {kind: 'content', key, variant: THUMBNAIL_VARIANT, format: THUMBNAIL_FORMAT}
}

function transientThumbnailReference(key: string): ThumbnailReference {
	return {kind: 'transient', key, variant: THUMBNAIL_VARIANT, format: THUMBNAIL_FORMAT}
}

function storedThumbnailIdentity(thumbnailDirectory: string, systemPath: string): ThumbnailIdentity | undefined {
	const parts = nodePath.relative(thumbnailDirectory, systemPath).split(nodePath.sep)
	if (parts.length !== 4 || (parts[0] !== 'content' && parts[0] !== 'transient')) return
	if (parts[1] !== THUMBNAIL_VARIANT) return
	const match = /^([a-f0-9]{64})\.webp$/.exec(parts[3])
	if (!match) return
	const key = match[1]
	if (parts[2] !== key.slice(0, 2)) return
	return {kind: parts[0], key}
}

async function isRecentTemporaryArtifact(systemPath: string) {
	if (!nodePath.basename(systemPath).includes('.tmp-')) return false
	try {
		const stats = await fse.lstat(systemPath)
		return stats.isFile() && Date.now() - stats.mtimeMs < TEMPORARY_ARTIFACT_GRACE_MS
	} catch {
		return false
	}
}

async function* walkArtifactFiles(directoryPath: string, logger: FileIndexEnrichmentLogger): AsyncGenerator<string> {
	let directory: Awaited<ReturnType<typeof opendir>>
	try {
		directory = await opendir(directoryPath)
	} catch (error) {
		logger.error(`Failed to inspect thumbnail artifact directory '${directoryPath}'`, error)
		return
	}

	try {
		for await (const entry of directory) {
			const systemPath = nodePath.join(directoryPath, entry.name)
			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				yield* walkArtifactFiles(systemPath, logger)
			} else {
				yield systemPath
			}
		}
	} catch (error) {
		logger.error(`Failed while inspecting thumbnail artifact directory '${directoryPath}'`, error)
	}
}

async function inConcurrentChunks<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
	for (let index = 0; index < items.length; index += concurrency) {
		await Promise.all(items.slice(index, index + concurrency).map(operation))
	}
}
