import nodePath from 'node:path'
import {appendFile, chmod, link, lstat, symlink, utimes, writeFile} from 'node:fs/promises'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'
import pRetry from 'p-retry'
import {afterEach, describe, expect, test, vi} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.js'
import FileIndex, {
	walkFileTree,
	type FileIndexEngineOptions,
	type FileIndexRoot,
	type WatcherChange,
} from './file-index-engine.js'
import {
	FILE_INDEX_SCHEMA_VERSION,
	fileIndexMigrations,
	migrateFileIndex,
	type FileIndexMigration,
} from './file-index/migrations.js'
import {THUMBNAIL_GENERATION_TIMEOUT_MS} from './file-index-enrichment.js'
import {THUMBNAIL_VARIANT, thumbnailSystemPath, type ThumbnailIdentity} from './thumbnail-support.js'

const temporary = temporaryDirectory()
const indexes: FileIndex[] = []

const logger = {
	log: vi.fn(),
	verbose: vi.fn(),
	error: vi.fn(),
}

afterEach(async () => {
	await Promise.all(indexes.splice(0).map((index) => index.stop()))
	await temporary.destroyRoot()
	vi.clearAllMocks()
})

async function fixture(
	walkTree?: FileIndexEngineOptions['walkTree'],
	options: Partial<
		Pick<
			FileIndexEngineOptions,
			'reconciliationIntervalMs' | 'watcherBulkThreshold' | 'batchSize' | 'enrichmentRuntime'
		>
	> = {},
) {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	await fse.ensureDir(homeDirectory)

	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: (name) => name.startsWith('.') || name.endsWith('.umbrel-upload'),
		walkTree,
		...options,
	})
	indexes.push(index)
	await index.start()

	const root: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: homeDirectory,
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	await index.setRoots([root])
	return {index, root, rootDirectory, dataDirectory, homeDirectory}
}

async function candidateNames(index: FileIndex, query: string, maxResults = 100) {
	return (await index.searchCandidates('/Home', query, maxResults)).map(({name}) => name).sort()
}

function noteWatcherChanges(index: FileIndex, paths: string[], type: WatcherChange['type'] = 'create') {
	index.noteWatcherChanges(
		'/Home',
		paths.map((path) => ({path, type})),
	)
}

function contentIdentity(key: string): ThumbnailIdentity {
	return {kind: 'content', key}
}

describe('file index migrations', () => {
	test('migrates fresh and already-migrated databases', async () => {
		const database = new BetterSqlite3(':memory:')
		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toMatchObject({
			count: FILE_INDEX_SCHEMA_VERSION,
		})
		expect(
			database
				.prepare('PRAGMA table_info(entries)')
				.all()
				.map((column: any) => column.name),
		).toStrictEqual([
			'id',
			'root_id',
			'relative_path',
			'name',
			'type',
			'size',
			'modified_ms',
			'hidden',
			'search_name',
			'search_name_folded',
			'device',
			'inode',
			'modified_ns',
			'ctime_ns',
			'thumbnail_identity_kind',
			'content_id',
			'hash_failure_count',
			'hash_retry_at',
			'hash_error',
			'observed_at',
		])
		expect(
			database
				.prepare(
					"SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('contents', 'thumbnail_variants', 'transient_thumbnail_variants') ORDER BY name",
				)
				.all(),
		).toStrictEqual([{name: 'contents'}, {name: 'thumbnail_variants'}, {name: 'transient_thumbnail_variants'}])

		const hashPlan = database
			.prepare(
				`EXPLAIN QUERY PLAN
				SELECT id FROM entries INDEXED BY entries_pending_content_hash
				WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL
					AND (hash_retry_at IS NULL OR hash_retry_at <= ?)
				ORDER BY hash_retry_at, id LIMIT 1`,
			)
			.all(Date.now()) as Array<{detail: string}>
		expect(hashPlan.some(({detail}) => detail.includes('entries_pending_content_hash'))).toBe(true)
		expect(hashPlan.some(({detail}) => detail.includes('USE TEMP B-TREE'))).toBe(false)

		for (const [state, workIndex, retryPredicate, parameters] of [
			['pending', 'thumbnail_variants_pending_work', '', []],
			['failed', 'thumbnail_variants_failed_work', 'AND thumbnail_variants.retry_at <= ?', [Date.now()]],
		] as const) {
			const workOrder =
				state === 'pending'
					? 'thumbnail_variants.content_id, entries.id'
					: 'thumbnail_variants.retry_at, thumbnail_variants.content_id, entries.id'
			const plan = database
				.prepare(
					`EXPLAIN QUERY PLAN
					SELECT contents.id FROM thumbnail_variants INDEXED BY ${workIndex}
					JOIN contents ON contents.id = thumbnail_variants.content_id
					JOIN entries INDEXED BY entries_by_content
						ON entries.content_id = thumbnail_variants.content_id
					WHERE thumbnail_variants.variant = ? AND thumbnail_variants.state = '${state}'
						${retryPredicate}
					ORDER BY ${workOrder} LIMIT 1`,
				)
				.all(THUMBNAIL_VARIANT, ...parameters) as Array<{detail: string}>
			expect(plan.some(({detail}) => detail.includes(workIndex))).toBe(true)
			expect(plan.some(({detail}) => detail === 'SCAN entries')).toBe(false)
		}
		database.exec(
			'CREATE TEMP TABLE content_gc_candidates(content_id INTEGER PRIMARY KEY, deferred_at INTEGER NOT NULL)',
		)
		const wakePlan = database
			.prepare(
				`EXPLAIN QUERY PLAN
				SELECT MIN(attempt_at) AS attempt_at FROM (
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
					SELECT MIN(deferred_at + ?) AS attempt_at FROM content_gc_candidates
				)`,
			)
			.all(THUMBNAIL_VARIANT, 6 * 60 * 60 * 1000) as Array<{detail: string}>
		expect(wakePlan.some(({detail}) => detail.includes('entries_pending_content_hash'))).toBe(true)
		expect(wakePlan.some(({detail}) => detail.includes('thumbnail_variants_failed_work'))).toBe(true)
		expect(wakePlan.some(({detail}) => detail.includes('entries_by_content'))).toBe(true)
		database.close()
	})

	test('migrates existing metadata rows to the lean entry schema', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, [fileIndexMigrations[0]])
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		database
			.prepare(
				`INSERT INTO entries(
					root_id, relative_path, parent_relative_path, name, type, mime_type,
					size, modified_ms, changed_ms, birth_ms, device, inode, mode, uid, gid, nlink,
					hidden, last_seen_generation, indexed_at, updated_at
				) VALUES (1, 'Documents/report.txt', 'Documents', 'report.txt', 'file', 'text/plain',
					7, 1234, 1235, 1200, 10, 20, 33188, 1000, 1000, 1, 0, 3, 100, 200)`,
			)
			.run()

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(database.prepare('SELECT * FROM entries').get()).toStrictEqual({
			id: 1,
			root_id: 1,
			relative_path: 'Documents/report.txt',
			name: 'report.txt',
			search_name: 'report.txt',
			search_name_folded: 'report.txt',
			type: 'file',
			size: 7,
			modified_ms: 1234,
			hidden: 0,
			device: '',
			inode: '',
			modified_ns: '',
			ctime_ns: '',
			thumbnail_identity_kind: null,
			content_id: null,
			hash_failure_count: 0,
			hash_retry_at: null,
			hash_error: null,
			observed_at: null,
		})
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"rep"'`).all(),
		).toStrictEqual([{rowid: 1}])
		expect(database.prepare("SELECT term, doc FROM entry_names_fts_vocab WHERE term = 'rep'").get()).toStrictEqual({
			term: 'rep',
			doc: 1,
		})
		database.prepare("UPDATE entries SET name = 'renamed.txt', search_name = 'renamed.txt' WHERE id = 1").run()
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"rep"'`).all(),
		).toStrictEqual([])
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"ren"'`).all(),
		).toStrictEqual([{rowid: 1}])
		database.prepare('DELETE FROM index_roots WHERE id = 1').run()
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"ren"'`).all(),
		).toStrictEqual([])
		database.close()
	})

	test('migrates a populated released v6 database directly to the final enrichment schema', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 6))
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		database
			.prepare(
				`INSERT INTO entries(
					root_id, relative_path, name, search_name, search_name_folded,
					type, size, modified_ms, hidden
				) VALUES (1, 'photo.png', 'photo.png', 'photo.png', 'photo.png', 'file', 5, 1, 0)`,
			)
			.run()

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(
			database
				.prepare(
					`SELECT relative_path, device, inode, modified_ns, ctime_ns, thumbnail_identity_kind,
						content_id, hash_failure_count, hash_retry_at, hash_error, observed_at
					FROM entries`,
				)
				.get(),
		).toStrictEqual({
			relative_path: 'photo.png',
			device: '',
			inode: '',
			modified_ns: '',
			ctime_ns: '',
			thumbnail_identity_kind: null,
			content_id: null,
			hash_failure_count: 0,
			hash_retry_at: null,
			hash_error: null,
			observed_at: null,
		})
		expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toStrictEqual({count: 7})
		expect(
			database
				.prepare('PRAGMA table_info(entries)')
				.all()
				.map((column: any) => column.name),
		).not.toContain('content_hash_valid')
		expect(
			database.prepare("SELECT name FROM sqlite_schema WHERE name = 'entries_by_content_identity'").get(),
		).toBeUndefined()
		const content = database
			.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
			.run(Buffer.alloc(32, 0xb1))
		database
			.prepare(
				`INSERT INTO thumbnail_variants(content_id, variant, state, updated_at)
				VALUES (?, ?, 'pending', 1)`,
			)
			.run(content.lastInsertRowid, THUMBNAIL_VARIANT)
		expect(database.prepare('SELECT content_id, variant, state FROM thumbnail_variants').get()).toStrictEqual({
			content_id: Number(content.lastInsertRowid),
			variant: THUMBNAIL_VARIANT,
			state: 'pending',
		})
		database.close()
	})

	test('normalizes populated schema v4 filenames when adding the search index', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 4))
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		const decomposedName = 'Café.jpg'.normalize('NFD')
		database
			.prepare(
				`INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden)
				VALUES (1, ?, ?, 'file', 0, 1, 0)`,
			)
			.run(decomposedName, decomposedName)

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(
			database.prepare('SELECT name, search_name, search_name_folded, thumbnail_identity_kind FROM entries').get(),
		).toStrictEqual({
			name: decomposedName,
			search_name: 'Café.jpg',
			search_name_folded: 'café.jpg',
			thumbnail_identity_kind: null,
		})
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"afé"'`).all(),
		).toStrictEqual([{rowid: 1}])
		database.close()
	})

	test('rolls back a partially-applied migration', async () => {
		const database = new BetterSqlite3(':memory:')
		const migrations: FileIndexMigration[] = [
			{
				version: 1,
				up: (transaction) => {
					transaction.exec('CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY)')
					throw new Error('migration failed')
				},
			},
		]

		await expect(migrateFileIndex(database, migrations)).rejects.toThrow('migration failed')
		expect(
			database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'should_not_exist'").get(),
		).toBeUndefined()
		database.close()
	})
})

test('walks past an unreadable child directory and reports its protected path', async () => {
	// A root process can read mode-000 directories, so the engine-level injected
	// error test below remains the portable assertion for privileged test runs.
	if (process.getuid?.() === 0) return

	const root = await temporary.create()
	const unreadable = nodePath.join(root, 'unreadable')
	const hiddenChild = nodePath.join(unreadable, 'hidden.txt')
	const readable = nodePath.join(root, 'readable.txt')
	await fse.outputFile(hiddenChild, 'hidden')
	await writeFile(readable, 'readable')
	await fse.chmod(unreadable, 0o000)

	const paths: string[] = []
	const errors: Array<{systemPath: string; error: unknown}> = []
	try {
		for await (const entry of walkFileTree(
			root,
			() => false,
			undefined,
			(systemPath, error) => {
				errors.push({systemPath, error})
			},
		)) {
			paths.push(entry.systemPath)
		}
	} finally {
		await fse.chmod(unreadable, 0o700)
	}

	expect(paths).toContain(readable)
	expect(paths).toContain(unreadable)
	expect(paths).not.toContain(hiddenChild)
	expect(errors).toHaveLength(1)
	expect(errors[0]).toMatchObject({systemPath: unreadable, error: {code: expect.stringMatching(/EACCES|EPERM/)}})
})

test('indexes accurate metadata and never follows symlinks', async () => {
	const {index, homeDirectory, rootDirectory} = await fixture()
	const visiblePath = nodePath.join(homeDirectory, 'photo.jpg')
	const hiddenPath = nodePath.join(homeDirectory, 'partial.umbrel-upload')
	const directoryPath = nodePath.join(homeDirectory, 'folder')
	const outsideDirectory = nodePath.join(rootDirectory, 'outside')
	await fse.ensureDir(directoryPath)
	await fse.ensureDir(outsideDirectory)
	await writeFile(visiblePath, 'hello')
	await writeFile(hiddenPath, 'partial')
	await writeFile(nodePath.join(outsideDirectory, 'must-not-be-indexed.txt'), 'secret')
	await symlink(outsideDirectory, nodePath.join(homeDirectory, 'outside-link'))

	await index.reconcileRoot('/Home', 'test')

	const stats = await lstat(visiblePath)
	await expect(index.getEntryByVirtualPath('/Home/photo.jpg')).resolves.toMatchObject({
		virtualPath: '/Home/photo.jpg',
		systemPath: visiblePath,
		type: 'file',
		size: 5,
		modifiedMs: Math.trunc(stats.mtimeMs),
		hidden: false,
	})
	await expect(index.getEntryByVirtualPath('/Home/folder')).resolves.toMatchObject({type: 'directory'})
	await expect(index.getEntryByVirtualPath('/Home/outside-link')).resolves.toMatchObject({type: 'symbolic-link'})
	await expect(index.getEntryByVirtualPath('/Home/outside-link/must-not-be-indexed.txt')).resolves.toBeUndefined()
	await expect(index.getEntryByVirtualPath('/Home/partial.umbrel-upload')).resolves.toMatchObject({hidden: true})
	await expect(candidateNames(index, 'photo')).resolves.toStrictEqual(['photo.jpg'])
	await expect(candidateNames(index, 'outside')).resolves.toStrictEqual(['outside-link'])
	await expect(candidateNames(index, 'folder')).resolves.toStrictEqual(['folder'])
	await expect(candidateNames(index, 'partial')).resolves.toStrictEqual([])
})

test('does not rewrite unchanged entries during reconciliation', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const file = nodePath.join(homeDirectory, 'stable.txt')
	await writeFile(file, 'stable')
	await index.reconcileRoot('/Home', 'initial')

	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.sqlite3')
	const database = new BetterSqlite3(databasePath)
	database.exec(`
		CREATE TABLE entry_update_audit(entry_id INTEGER NOT NULL);
		CREATE TRIGGER audit_entry_update AFTER UPDATE ON entries BEGIN
			INSERT INTO entry_update_audit(entry_id) VALUES (new.id);
		END;
	`)
	database.close()

	await index.reconcileRoot('/Home', 'unchanged')
	let audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 0})
	audit.close()

	await writeFile(file, 'changed-size')
	await index.reconcileRoot('/Home', 'changed-size')
	audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 1})
	audit.close()

	const future = new Date(Date.now() + 10_000)
	await utimes(file, future, future)
	await index.reconcileRoot('/Home', 'changed-mtime')
	audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 2})
	audit.close()

	await fse.remove(file)
	await fse.ensureDir(file)
	await index.reconcileRoot('/Home', 'changed-type')
	audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 3})
	audit.close()
	await expect(index.getEntryBySystemPath(file)).resolves.toMatchObject({type: 'directory'})
})

test('records stable file identities and invalidates content hashes only when the file revision changes', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const image = nodePath.join(homeDirectory, 'photo.png')
	const unsupported = nodePath.join(homeDirectory, 'notes.txt')
	await Promise.all([writeFile(image, 'image'), writeFile(unsupported, 'notes')])
	await index.reconcileRoot('/Home', 'initial')

	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.sqlite3')
	let database = new BetterSqlite3(databasePath)
	const imageStats = await lstat(image, {bigint: true})
	expect(
		database
			.prepare(
				`SELECT device, inode, modified_ns, ctime_ns, thumbnail_identity_kind, content_id
				FROM entries WHERE relative_path = 'photo.png'`,
			)
			.get(),
	).toStrictEqual({
		device: imageStats.dev.toString(),
		inode: imageStats.ino.toString(),
		modified_ns: imageStats.mtimeNs.toString(),
		ctime_ns: imageStats.ctimeNs.toString(),
		thumbnail_identity_kind: 'content',
		content_id: null,
	})
	expect(
		database.prepare("SELECT thumbnail_identity_kind FROM entries WHERE relative_path = 'notes.txt'").get(),
	).toStrictEqual({thumbnail_identity_kind: null})

	const content = database
		.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, ?, ?) RETURNING id')
		.get(Buffer.alloc(32, 1), imageStats.size, Date.now()) as {id: number}
	database.prepare("UPDATE entries SET content_id = ? WHERE relative_path = 'photo.png'").run(content.id)
	database.close()

	// Raw device IDs are mount-session details, not part of managed content
	// identity. A changed device value must update metadata without rehashing.
	database = new BetterSqlite3(databasePath)
	database.prepare("UPDATE entries SET device = 'different-mount-device' WHERE relative_path = 'photo.png'").run()
	database.close()
	await index.reconcileRoot('/Home', 'unchanged')
	database = new BetterSqlite3(databasePath)
	expect(database.prepare("SELECT content_id FROM entries WHERE relative_path = 'photo.png'").get()).toStrictEqual({
		content_id: content.id,
	})
	database.close()

	// ctime catches metadata-only replacement/change cases that inode, size and
	// mtime alone can miss.
	await chmod(image, 0o600)
	await index.reconcileRoot('/Home', 'changed-ctime')
	database = new BetterSqlite3(databasePath)
	expect(database.prepare("SELECT content_id FROM entries WHERE relative_path = 'photo.png'").get()).toStrictEqual({
		content_id: null,
	})
	database.prepare("UPDATE entries SET content_id = ? WHERE relative_path = 'photo.png'").run(content.id)
	database.close()

	const future = new Date(Date.now() + 10_000)
	await utimes(image, future, future)
	await index.reconcileRoot('/Home', 'changed-mtime')
	database = new BetterSqlite3(databasePath)
	expect(database.prepare("SELECT content_id FROM entries WHERE relative_path = 'photo.png'").get()).toStrictEqual({
		content_id: null,
	})
	database.close()
})

test('hashes and generates a content-addressed thumbnail on demand', async () => {
	const digest = Buffer.alloc(32, 0xab)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'photo.png')
	await writeFile(image, 'image')

	const reference = await index.ensureThumbnail(image)
	expect(reference).toStrictEqual({
		kind: 'content',
		key: digest.toString('hex'),
		variant: THUMBNAIL_VARIANT,
		format: 'webp',
	})
	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
	await expect(index.getExistingThumbnail(image)).resolves.toStrictEqual(reference)
	await expect(index.matchesThumbnail(image, reference.kind, reference.key, reference.variant)).resolves.toBe(true)
	await expect(index.matchesThumbnail(image, 'content', '00'.repeat(32), reference.variant)).resolves.toBe(false)

	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await expect(fse.readFile(thumbnail, 'utf8')).resolves.toBe('thumbnail')
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT COUNT(*) AS count FROM thumbnail_variants').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT content_id FROM entries WHERE relative_path = ?').get('photo.png')).toMatchObject({
		content_id: expect.any(Number),
	})
	database.close()
})

test('recreates externally removed thumbnail shard directories', async () => {
	const digests = [Buffer.alloc(32, 0xb1), Buffer.alloc(32, 0xb2)]
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await writeFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digests.shift()!, generateThumbnail},
	})
	const firstImage = nodePath.join(homeDirectory, 'first.png')
	await writeFile(firstImage, 'first')
	await index.ensureThumbnail(firstImage)

	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	await fse.remove(thumbnailDirectory)
	const secondImage = nodePath.join(homeDirectory, 'second.png')
	await writeFile(secondImage, 'second')
	const second = await index.ensureThumbnail(secondImage)

	await expect(fse.readFile(thumbnailSystemPath(thumbnailDirectory, second), 'utf8')).resolves.toBe('thumbnail')
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('keeps the file index available when thumbnail artifact storage cannot start', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const image = nodePath.join(homeDirectory, 'photo.png')
	await Promise.all([
		fse.outputFile(nodePath.join(dataDirectory, 'thumbnails'), 'blocks the thumbnail directory'),
		fse.outputFile(image, 'image'),
	])
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(index)

	await index.start()
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])
	await index.reconcileRoot('/Home', 'thumbnail-storage-failure')

	await expect(index.status()).resolves.toMatchObject({available: true, entryCount: 1})
	await expect(candidateNames(index, 'photo')).resolves.toStrictEqual(['photo.png'])
	expect(logger.error).toHaveBeenCalledWith(
		'Thumbnail artifact storage is unavailable; file indexing will continue',
		expect.objectContaining({code: 'EEXIST'}),
	)
})

test('backs off persistent runtime artifact-directory failures instead of hot-looping', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const image = nodePath.join(homeDirectory, 'photo.png')
	await Promise.all([
		fse.outputFile(nodePath.join(dataDirectory, 'thumbnails'), 'blocks the thumbnail directory'),
		fse.outputFile(image, 'image'),
	])
	const generateThumbnail = vi.fn()
	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: () => false,
		enrichmentRuntime: {hashFile: async () => Buffer.alloc(32, 0xbc), generateThumbnail},
	})
	indexes.push(index)
	await index.start()
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])
	await index.reconcileRoot('/Home', 'artifact-runtime-failure')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.status()).toMatchObject({enrichment: {thumbnailFailures: 1}}), {
		retries: 50,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await new Promise((resolve) => setTimeout(resolve, 150))
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'failed',
		failure_count: 1,
	})
	database.close()
	expect(generateThumbnail).not.toHaveBeenCalled()
	expect(
		logger.error.mock.calls.filter(([message]) => String(message).startsWith(`Failed to enrich '${image}'`)),
	).toHaveLength(1)
})

test('rejects unsupported thumbnail sources without reconciling their root', async () => {
	const walkTree = vi.fn(walkFileTree)
	const {index, homeDirectory} = await fixture(walkTree)
	await index.reconcileRoot('/Home', 'initial')
	walkTree.mockClear()
	const directory = nodePath.join(homeDirectory, 'album.jpg')
	const unsupported = nodePath.join(homeDirectory, 'notes.txt')
	await Promise.all([fse.ensureDir(directory), writeFile(unsupported, 'notes')])

	await expect(index.ensureThumbnail(directory)).rejects.toThrow('Unsupported or missing thumbnail source')
	await expect(index.ensureThumbnail(unsupported)).rejects.toThrow('Unsupported or missing thumbnail source')
	expect(walkTree).not.toHaveBeenCalled()
})

test('indexes transient storage files on demand without hashing or crawling the storage root', async () => {
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xac))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const image = nodePath.join(externalDirectory, 'camera', 'photo.png')
	await fse.outputFile(image, 'external image')
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})

	await index.reconcileAll('must-not-crawl-transient-storage')
	await expect(index.getEntryBySystemPath(image)).resolves.toBeUndefined()
	const reference = await index.ensureThumbnail(image)
	expect(reference).toMatchObject({
		kind: 'transient',
		key: expect.stringMatching(/^[a-f0-9]{64}$/),
		variant: THUMBNAIL_VARIANT,
		format: 'webp',
	})
	await expect(index.getEntryBySystemPath(image)).resolves.toMatchObject({name: 'photo.png'})
	expect(hashFile).not.toHaveBeenCalled()
	expect(generateThumbnail).toHaveBeenCalledOnce()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 0})
	expect(
		database
			.prepare('SELECT thumbnail_identity_kind, content_id FROM entries WHERE relative_path = ?')
			.get('camera/photo.png'),
	).toStrictEqual({thumbnail_identity_kind: 'transient', content_id: null})
	expect(database.prepare('SELECT artifact_key, state FROM transient_thumbnail_variants').get()).toStrictEqual({
		artifact_key: reference.key,
		state: 'ready',
	})
	database.close()
})

test('publishes a transient thumbnail only for a stable filesystem fingerprint', async () => {
	let mutateSource = true
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
		if (mutateSource) {
			mutateSource = false
			await appendFile(source, ' changed during generation')
		}
	})
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: {generateThumbnail}})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const image = nodePath.join(externalDirectory, 'camera.png')
	await fse.outputFile(image, 'external image')
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})

	const reference = await index.ensureThumbnail(image)
	expect(reference.kind).toBe('transient')
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
	await expect(
		fse.pathExists(thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)),
	).resolves.toBe(true)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 0})
	expect(database.prepare('SELECT COUNT(*) AS count FROM transient_thumbnail_variants').get()).toStrictEqual({count: 1})
	database.close()
})

test('refreshes used transient thumbnails and expires entries unused for seven days', async () => {
	const day = 24 * 60 * 60 * 1000
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			generateThumbnail,
		},
	})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const unused = nodePath.join(externalDirectory, 'unused.png')
	const retained = nodePath.join(externalDirectory, 'retained.png')
	await Promise.all([fse.outputFile(unused, 'unused'), fse.outputFile(retained, 'retained')])
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})

	const unusedReference = await index.ensureThumbnail(unused)
	const retainedReference = await index.ensureThumbnail(retained)
	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.sqlite3')
	const setObservedAt = (relativePath: string, observedAt: number) => {
		const database = new BetterSqlite3(databasePath)
		database.prepare('UPDATE entries SET observed_at = ? WHERE relative_path = ?').run(observedAt, relativePath)
		database.close()
	}
	const observedAt = (relativePath: string) => {
		const database = new BetterSqlite3(databasePath, {readonly: true})
		const row = database.prepare('SELECT observed_at FROM entries WHERE relative_path = ?').get(relativePath) as
			| {observed_at: number}
			| undefined
		database.close()
		return row?.observed_at
	}

	setObservedAt('retained.png', Date.now() - 2 * day)
	await expect(index.getExistingThumbnail(retained)).resolves.toStrictEqual(retainedReference)
	const listingObservation = observedAt('retained.png')!
	expect(listingObservation).toBeGreaterThan(Date.now() - day)
	await expect(index.getExistingThumbnail(retained)).resolves.toStrictEqual(retainedReference)
	expect(observedAt('retained.png')).toBe(listingObservation)

	setObservedAt('retained.png', Date.now() - 2 * day)
	await expect(
		index.matchesThumbnail(retained, retainedReference.kind, retainedReference.key, retainedReference.variant),
	).resolves.toBe(true)
	expect(observedAt('retained.png')).toBeGreaterThan(Date.now() - day)
	setObservedAt('retained.png', Date.now() - 2 * day)
	await expect(index.ensureThumbnail(retained)).resolves.toStrictEqual(retainedReference)
	expect(observedAt('retained.png')).toBeGreaterThan(Date.now() - day)

	setObservedAt('unused.png', Date.now() - 8 * day)
	await fse.remove(unused)
	await index.reconcileAll('expire-transient-entries')
	await expect(index.getEntryBySystemPath(unused)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(retained)).resolves.toMatchObject({name: 'retained.png'})

	index.startBackgroundReconciliation()
	const unusedThumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), unusedReference)
	await pRetry(async () => expect(await fse.pathExists(unusedThumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('keeps reconciliation non-rejecting when transient expiry fails', async () => {
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const image = nodePath.join(externalDirectory, 'expired.png')
	await fse.outputFile(image, 'external image')
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})
	await index.ensureThumbnail(image)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.prepare('UPDATE entries SET observed_at = 0 WHERE relative_path = ?').run('expired.png')
	database.exec(`
		CREATE TRIGGER reject_transient_expiry BEFORE DELETE ON entries
		WHEN OLD.observed_at = 0
		BEGIN
			SELECT RAISE(ABORT, 'injected transient expiry failure');
		END
	`)
	database.close()

	await expect(index.reconcileAll('transient-expiry-failure')).resolves.toBeUndefined()
	expect(logger.error).toHaveBeenCalledWith(
		'Failed to expire unused transient file index entries',
		expect.objectContaining({message: 'injected transient expiry failure'}),
	)
	await expect(index.getEntryBySystemPath(image)).resolves.toMatchObject({name: 'expired.png'})
})

test('uses the standard BLAKE3 digest and never rehashes an unchanged revision', async () => {
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {generateThumbnail}})
	const image = nodePath.join(homeDirectory, 'known.png')
	await writeFile(image, 'abc')

	const first = await index.ensureThumbnail(image)
	expect(first.key).toBe('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85')
	await expect(index.ensureThumbnail(image)).resolves.toStrictEqual(first)
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('rehashes a changed revision and garbage-collects its old content-addressed asset', async () => {
	const digests = [Buffer.alloc(32, 0x21), Buffer.alloc(32, 0x22)]
	const hashFile = vi.fn(async () => digests.shift()!)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'changing.png')
	await writeFile(image, 'first')
	const first = await index.ensureThumbnail(image)
	await expect(index.ensureThumbnail(image)).resolves.toStrictEqual(first)

	await writeFile(image, 'second revision with a different size')
	const second = await index.ensureThumbnail(image)
	expect(second.key).not.toBe(first.key)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)

	const oldThumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), first)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await fse.pathExists(oldThumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
})

test('drains the durable thumbnail backlog one entry at a time', async () => {
	let releaseGeneration!: () => void
	let signalGeneration!: () => void
	const generationStarted = new Promise<void>((resolve) => (signalGeneration = resolve))
	const generationReleased = new Promise<void>((resolve) => (releaseGeneration = resolve))
	let firstGeneration = true
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		if (firstGeneration) {
			firstGeneration = false
			signalGeneration()
			await generationReleased
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const hashFile = vi.fn(async (systemPath: string) => {
		const number = Number(nodePath.basename(systemPath).match(/\d+/)?.[0] ?? 0)
		return Buffer.alloc(32, number + 1)
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const fileCount = 100
	await Promise.all(
		Array.from({length: fileCount}, (_, number) =>
			writeFile(nodePath.join(homeDirectory, `background-${String(number).padStart(3, '0')}.png`), String(number)),
		),
	)

	index.startBackgroundReconciliation()
	await generationStarted
	await expect(index.status()).resolves.toMatchObject({
		entryCount: fileCount,
		roots: [{state: 'ready'}],
		enrichment: {eligibleEntries: fileCount, readyThumbnails: 0},
	})

	releaseGeneration()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({
				enrichment: {
					eligibleEntries: fileCount,
					hashedEntries: fileCount,
					pendingHashes: 0,
					uniqueContents: fileCount,
					readyThumbnails: fileCount,
				},
			})
		},
		{retries: 500, minTimeout: 10, maxTimeout: 20},
	)
	expect(hashFile).toHaveBeenCalledTimes(fileCount)
	expect(generateThumbnail).toHaveBeenCalledTimes(fileCount)
})

test('continues background thumbnail enrichment during an active metadata reconciliation', async () => {
	let releaseScan!: () => void
	let signalScanBlocked!: () => void
	const scanReleased = new Promise<void>((resolve) => (releaseScan = resolve))
	const scanBlocked = new Promise<void>((resolve) => (signalScanBlocked = resolve))
	let blockAfterFirstEntry = true
	const walkTree: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (
		rootSystemPath,
		stopping,
		includePath,
		onPathError,
	) {
		for await (const entry of walkFileTree(rootSystemPath, stopping, includePath, onPathError)) {
			yield entry
			if (blockAfterFirstEntry) {
				blockAfterFirstEntry = false
				signalScanBlocked()
				await scanReleased
			}
		}
	}
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xb7))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(walkTree, {
		batchSize: 1,
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	await writeFile(nodePath.join(homeDirectory, 'during-scan.png'), 'image')

	index.startBackgroundReconciliation()
	await scanBlocked
	try {
		await pRetry(
			async () => {
				await expect(index.status()).resolves.toMatchObject({
					roots: [{state: 'warming'}],
					enrichment: {hashedEntries: 1, readyThumbnails: 1},
				})
			},
			{retries: 200, minTimeout: 10, maxTimeout: 20},
		)
	} finally {
		releaseScan()
	}

	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('serves on-demand work while a background conversion is still active', async () => {
	let releaseBackground!: () => void
	let signalBackgroundStarted!: () => void
	const backgroundReleased = new Promise<void>((resolve) => (releaseBackground = resolve))
	const backgroundStarted = new Promise<void>((resolve) => (signalBackgroundStarted = resolve))
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		if (nodePath.basename(source) === 'background.png') {
			signalBackgroundStarted()
			await backgroundReleased
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const hashFile = vi.fn(async (systemPath: string) => {
		return Buffer.alloc(32, nodePath.basename(systemPath) === 'background.png' ? 0xc1 : 0xc2)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const background = nodePath.join(homeDirectory, 'background.png')
	const requested = nodePath.join(homeDirectory, 'requested.png')
	await writeFile(background, 'background')
	await index.reconcilePath(background)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()

	index.startBackgroundReconciliation()
	await backgroundStarted
	await writeFile(requested, 'requested')
	try {
		await expect(
			Promise.race([
				index.ensureThumbnail(requested),
				new Promise((_, reject) => setTimeout(() => reject(new Error('on-demand work was blocked')), 1_000)),
			]),
		).resolves.toMatchObject({kind: 'content', key: 'c2'.repeat(32)})
	} finally {
		releaseBackground()
	}

	expect(generateThumbnail.mock.calls.map(([source]) => nodePath.basename(source))).toStrictEqual([
		'background.png',
		'requested.png',
	])
})

test('does not restart background hashing while on-demand work is active', async () => {
	let releaseOnDemand!: () => void
	let signalOnDemandStarted!: () => void
	const onDemandReleased = new Promise<void>((resolve) => (releaseOnDemand = resolve))
	const onDemandStarted = new Promise<void>((resolve) => (signalOnDemandStarted = resolve))
	const hashFile = vi.fn(async (systemPath: string) =>
		Buffer.alloc(32, nodePath.basename(systemPath) === 'requested.png' ? 0xd1 : 0xd2),
	)
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		if (nodePath.basename(source) === 'requested.png') {
			signalOnDemandStarted()
			await onDemandReleased
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const requested = nodePath.join(homeDirectory, 'requested.png')
	const background = nodePath.join(homeDirectory, 'background.png')
	await Promise.all([writeFile(requested, 'requested'), writeFile(background, 'background')])
	await Promise.all([index.reconcilePath(requested), index.reconcilePath(background)])
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()

	const requestedThumbnail = index.ensureThumbnail(requested)
	await onDemandStarted
	index.startBackgroundReconciliation()
	try {
		await new Promise((resolve) => setTimeout(resolve, 350))
		expect(hashFile.mock.calls.map(([source]) => nodePath.basename(source))).toStrictEqual(['requested.png'])
	} finally {
		releaseOnDemand()
	}
	await expect(requestedThumbnail).resolves.toMatchObject({kind: 'content', key: 'd1'.repeat(32)})
	await pRetry(async () => expect(await index.status()).toMatchObject({enrichment: {readyThumbnails: 2}}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(hashFile).toHaveBeenCalledTimes(2)
})

test('shares content and one thumbnail between duplicate files', async () => {
	const digest = Buffer.alloc(32, 0xcd)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const first = nodePath.join(homeDirectory, 'first.png')
	const second = nodePath.join(homeDirectory, 'second.png')
	await Promise.all([writeFile(first, 'same content'), writeFile(second, 'same content')])

	const [firstReference, secondReference] = await Promise.all([
		index.ensureThumbnail(first),
		index.ensureThumbnail(second),
	])
	expect(secondReference).toStrictEqual(firstReference)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT COUNT(DISTINCT content_id) AS count FROM entries').get()).toStrictEqual({count: 1})
	database.close()
})

test('uses another duplicate when a thumbnail content reference disappears', async () => {
	const digest = Buffer.alloc(32, 0xcf)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const vanished = nodePath.join(homeDirectory, 'first.png')
	const available = nodePath.join(homeDirectory, 'second.png')
	await Promise.all([writeFile(vanished, 'same content'), writeFile(available, 'same content')])
	const reference = await index.ensureThumbnail(vanished)
	await index.ensureThumbnail(available)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await fse.remove(thumbnail)
	await expect(index.getExistingThumbnail(available)).resolves.toBeUndefined()
	generateThumbnail.mockClear()
	await fse.remove(vanished)

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.getExistingThumbnail(available)).toStrictEqual(reference), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(generateThumbnail).toHaveBeenCalledOnce()
	expect(generateThumbnail.mock.calls[0]?.[0]).toBe(available)
	await expect(index.getEntryBySystemPath(vanished)).resolves.toBeUndefined()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'ready',
		failure_count: 0,
	})
	database.close()
})

test('does not retry a failed thumbnail for every newly hashed duplicate', async () => {
	const digest = Buffer.alloc(32, 0xce)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async () => {
		throw new Error('invalid image')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const fileCount = 20
	const old = new Date(Date.now() - 10_000)
	await Promise.all(
		Array.from({length: fileCount}, async (_, number) => {
			const image = nodePath.join(homeDirectory, `invalid-duplicate-${number}.png`)
			await writeFile(image, 'same invalid image')
			await utimes(image, old, old)
		}),
	)
	await index.reconcileRoot('/Home', 'duplicate-failure-test')

	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({
				enrichment: {
					hashedEntries: fileCount,
					pendingHashes: 0,
					uniqueContents: 1,
					thumbnailFailures: 1,
				},
			})
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)

	expect(hashFile).toHaveBeenCalledTimes(fileCount)
	expect(generateThumbnail).toHaveBeenCalledOnce()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'failed',
		failure_count: 1,
	})
	database.close()
})

test('hashes each new hard-link entry before deduplicating by its content hash', async () => {
	const digest = Buffer.alloc(32, 0xef)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const first = nodePath.join(homeDirectory, 'first.png')
	const hardLink = nodePath.join(homeDirectory, 'hard-link.png')
	await writeFile(first, 'same inode')
	await link(first, hardLink)

	await index.ensureThumbnail(first)
	await index.ensureThumbnail(hardLink)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('rehashes a moved entry and reuses its content-addressed thumbnail', async () => {
	const digest = Buffer.alloc(32, 0xf1)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const source = nodePath.join(homeDirectory, 'source.png')
	const destination = nodePath.join(homeDirectory, 'destination.png')
	await writeFile(source, 'same inode after rename')
	const before = await index.ensureThumbnail(source)

	await fse.move(source, destination)
	await index.movePath(source, destination)
	const after = await index.ensureThumbnail(destination)

	expect(after).toStrictEqual(before)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()
	await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(
		database.prepare("SELECT content_id FROM entries WHERE relative_path = 'destination.png'").get(),
	).toMatchObject({
		content_id: expect.any(Number),
	})
	database.close()
})

test('rehashes moved directory entries and reuses their content-addressed thumbnails', async () => {
	const hashFile = vi.fn(async (systemPath: string) => {
		const number = Number(nodePath.basename(systemPath).match(/\d+/)?.[0] ?? 0)
		return Buffer.alloc(32, number + 1)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const source = nodePath.join(homeDirectory, 'source-directory')
	const destination = nodePath.join(homeDirectory, 'destination-directory')
	await Promise.all(
		Array.from({length: 3}, (_, number) =>
			fse.outputFile(nodePath.join(source, `image-${number}.png`), `image ${number}`),
		),
	)
	const before = await Promise.all(
		Array.from({length: 3}, (_, number) => index.ensureThumbnail(nodePath.join(source, `image-${number}.png`))),
	)

	await fse.move(source, destination)
	await index.movePath(source, destination)
	const after = await Promise.all(
		Array.from({length: 3}, (_, number) => index.ensureThumbnail(nodePath.join(destination, `image-${number}.png`))),
	)

	expect(after).toStrictEqual(before)
	expect(hashFile).toHaveBeenCalledTimes(6)
	expect(generateThumbnail).toHaveBeenCalledTimes(3)
})

test('processes watcher move destinations before deletions and reuses their content thumbnail', async () => {
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xa4))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const source = nodePath.join(homeDirectory, 'watcher-source.png')
	const destination = nodePath.join(homeDirectory, 'watcher-destination.png')
	await writeFile(source, 'watcher move')
	const before = await index.ensureThumbnail(source)

	await fse.move(source, destination)
	index.noteWatcherChanges('/Home', [
		{path: source, type: 'delete'},
		...Array.from({length: 99}, (_, index) => ({
			path: nodePath.join(homeDirectory, `missing-${index}.png`),
			type: 'create' as const,
		})),
		{path: destination, type: 'create'},
	])
	await pRetry(async () => expect(await index.getEntryBySystemPath(source)).toBeUndefined(), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const after = await index.ensureThumbnail(destination)

	expect(after).toStrictEqual(before)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('defers content GC while a watcher-moved destination is being rehashed in the background', async () => {
	const digest = Buffer.alloc(32, 0xa5)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const source = nodePath.join(homeDirectory, 'background-source.png')
	const destination = nodePath.join(homeDirectory, 'background-destination.png')
	await writeFile(source, 'watcher move')
	const reference = await index.ensureThumbnail(source)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.status()).toMatchObject({roots: [{state: 'ready'}]}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})

	await fse.move(source, destination)
	index.noteWatcherChanges('/Home', [
		{path: source, type: 'delete'},
		{path: destination, type: 'create'},
	])
	await pRetry(async () => expect(await index.getExistingThumbnail(destination)).toStrictEqual(reference), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('garbage-collects a deferred content candidate after its safety deadline', async () => {
	const digest = Buffer.alloc(32, 0xa6)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail, orphanGcMaxDeferralMs: 300},
	})
	const removed = nodePath.join(homeDirectory, 'removed.png')
	const pending = nodePath.join(homeDirectory, 'pending.png')
	await writeFile(removed, 'removed')
	const reference = await index.ensureThumbnail(removed)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await writeFile(pending, 'pending')
	await index.reconcilePath(pending)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.prepare("UPDATE entries SET hash_retry_at = ? WHERE relative_path = 'pending.png'").run(Date.now() + 5_000)
	database.close()
	await fse.remove(removed)
	await index.removePath(removed)

	index.startBackgroundReconciliation()
	await new Promise((resolve) => setTimeout(resolve, 50))
	await expect(fse.pathExists(thumbnail)).resolves.toBe(true)
	await pRetry(async () => expect(await fse.pathExists(thumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(hashFile).toHaveBeenCalledOnce()
})

test('hash failures do not prevent unrelated content garbage collection', async () => {
	const digest = Buffer.alloc(32, 0xa7)
	const hashFile = vi.fn(async (systemPath: string) => {
		if (nodePath.basename(systemPath) === 'unreadable.png') throw new Error('injected unreadable source')
		return digest
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const removed = nodePath.join(homeDirectory, 'removed.png')
	const unreadable = nodePath.join(homeDirectory, 'unreadable.png')
	await writeFile(removed, 'removed')
	const reference = await index.ensureThumbnail(removed)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await writeFile(unreadable, 'unreadable')
	await expect(index.ensureThumbnail(unreadable)).rejects.toThrow('injected unreadable source')
	await fse.remove(removed)
	await index.removePath(removed)

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await fse.pathExists(thumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.status()).resolves.toMatchObject({enrichment: {hashFailures: 1, pendingHashes: 1}})
	expect(hashFile).toHaveBeenCalledTimes(2)
})

test('keeps shared assets until the final indexed content reference is deleted', async () => {
	const digest = Buffer.alloc(32, 0x12)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const first = nodePath.join(homeDirectory, 'first.png')
	const second = nodePath.join(homeDirectory, 'second.png')
	await Promise.all([writeFile(first, 'same'), writeFile(second, 'same')])
	const reference = await index.ensureThumbnail(first)
	await index.ensureThumbnail(second)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	index.startBackgroundReconciliation()

	await fse.remove(first)
	await index.removePath(first)
	await expect(fse.pathExists(thumbnail)).resolves.toBe(true)

	await fse.remove(second)
	await index.removePath(second)
	await pRetry(async () => expect(await fse.pathExists(thumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 0})
	expect(database.prepare('SELECT COUNT(*) AS count FROM thumbnail_variants').get()).toStrictEqual({count: 0})
	database.close()
})

test('serializes artifact GC with re-adoption of the same content hash', async () => {
	const digest = Buffer.alloc(32, 0x13)
	let blockedArtifact: string | undefined
	let releaseRemoval!: () => void
	let signalRemoval!: () => void
	const removalStarted = new Promise<void>((resolve) => (signalRemoval = resolve))
	const removalReleased = new Promise<void>((resolve) => (releaseRemoval = resolve))
	const remove = vi.fn(async (systemPath: string) => {
		if (systemPath === blockedArtifact) {
			signalRemoval()
			await removalReleased
			blockedArtifact = undefined
		}
		await fse.remove(systemPath)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail, remove},
	})
	const first = nodePath.join(homeDirectory, 'first.png')
	const second = nodePath.join(homeDirectory, 'second.png')
	await writeFile(first, 'same bytes')
	const reference = await index.ensureThumbnail(first)
	blockedArtifact = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)

	await fse.remove(first)
	await index.removePath(first)
	index.startBackgroundReconciliation()
	await removalStarted

	await writeFile(second, 'same bytes')
	let settled = false
	const reAdopted = index.ensureThumbnail(second).finally(() => (settled = true))
	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(settled).toBe(false)

	releaseRemoval()
	await expect(reAdopted).resolves.toStrictEqual(reference)
	await expect(
		fse.pathExists(thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)),
	).resolves.toBe(true)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT state FROM thumbnail_variants').get()).toStrictEqual({state: 'ready'})
	database.close()
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('repairs missing and untracked thumbnail artifacts without racing recent temporary publications', async () => {
	const digest = Buffer.alloc(32, 0x34)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, `thumbnail-${generateThumbnail.mock.calls.length}`)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'repair.png')
	await writeFile(image, 'image')
	const reference = await index.ensureThumbnail(image)
	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	const thumbnail = thumbnailSystemPath(thumbnailDirectory, reference)

	// Simulate all relevant crash leftovers: a ready DB row with no file, a
	// sharded artifact with no content row, a temporary, the discarded two-level
	// shard layout, and an old flat LRU-era artifact. All recovery is inferred
	// from authoritative DB state.
	await fse.remove(thumbnail)
	const orphan = thumbnailSystemPath(thumbnailDirectory, contentIdentity('56'.repeat(32)))
	const temporary = `${thumbnail}.tmp-interrupted.webp`
	const recentTemporary = `${thumbnail}.tmp-active.webp`
	const oldTwoLevel = nodePath.join(
		thumbnailDirectory,
		THUMBNAIL_VARIANT,
		reference.key.slice(0, 2),
		reference.key.slice(2, 4),
		`${reference.key}.webp`,
	)
	const legacy = nodePath.join(thumbnailDirectory, 'legacy-random-id.webp')
	const emptyShard = nodePath.join(thumbnailDirectory, 'content', THUMBNAIL_VARIANT, 'ff')
	await Promise.all([
		fse.outputFile(orphan, 'orphan'),
		fse.outputFile(temporary, 'temporary'),
		fse.outputFile(recentTemporary, 'active temporary'),
		fse.outputFile(oldTwoLevel, 'old-two-level'),
		fse.outputFile(legacy, 'legacy'),
		fse.ensureDir(emptyShard),
	])
	const staleTemporaryTime = new Date(Date.now() - 2 * THUMBNAIL_GENERATION_TIMEOUT_MS - 1_000)
	await utimes(temporary, staleTemporaryTime, staleTemporaryTime)

	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			expect(await fse.pathExists(thumbnail)).toBe(true)
			expect(await fse.pathExists(orphan)).toBe(false)
			expect(await fse.pathExists(temporary)).toBe(false)
			expect(await fse.pathExists(oldTwoLevel)).toBe(false)
			expect(await fse.pathExists(legacy)).toBe(false)
			expect(await fse.pathExists(recentTemporary)).toBe(true)
			expect(await fse.pathExists(emptyShard)).toBe(true)
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'artifact_gc'").get()).toBeUndefined()
	expect(database.prepare('SELECT state FROM thumbnail_variants').get()).toStrictEqual({state: 'ready'})
	database.close()
})

test('preserves pre-quarantine artifacts until a replacement index finishes rebuilding', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const image = nodePath.join(homeDirectory, 'recovered.png')
	const digest = Buffer.alloc(32, 0x57)
	const thumbnail = thumbnailSystemPath(
		nodePath.join(dataDirectory, 'thumbnails'),
		contentIdentity(digest.toString('hex')),
	)
	await Promise.all([fse.outputFile(image, 'image'), fse.outputFile(thumbnail, 'existing thumbnail')])
	const databaseDirectory = nodePath.join(dataDirectory, 'file-index')
	await fse.ensureDir(databaseDirectory)
	await writeFile(nodePath.join(databaseDirectory, 'index.sqlite3'), 'not a database')

	let releaseWalk!: () => void
	let signalWalk!: () => void
	const walkStarted = new Promise<void>((resolve) => (signalWalk = resolve))
	const walkReleased = new Promise<void>((resolve) => (releaseWalk = resolve))
	let firstWalk = true
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (...arguments_) {
		if (firstWalk) {
			firstWalk = false
			signalWalk()
			await walkReleased
		}
		yield* walkFileTree(...arguments_)
	}
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'generated thumbnail')
	})
	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: () => false,
		walkTree: walk,
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	indexes.push(index)
	await index.start()
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])
	index.startBackgroundReconciliation()
	await walkStarted
	await new Promise((resolve) => setTimeout(resolve, 50))
	await expect(fse.readFile(thumbnail, 'utf8')).resolves.toBe('existing thumbnail')

	releaseWalk()
	await pRetry(
		async () =>
			expect(await index.getExistingThumbnail(image)).toMatchObject({kind: 'content', key: digest.toString('hex')}),
		{
			retries: 200,
			minTimeout: 10,
			maxTimeout: 20,
		},
	)
	await expect(fse.readFile(thumbnail, 'utf8')).resolves.toBe('existing thumbnail')
	expect(generateThumbnail).not.toHaveBeenCalled()
})

test('never publishes an empty thumbnail artifact as ready', async () => {
	const digest = Buffer.alloc(32, 0x35)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, '')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'empty-output.png')
	await writeFile(image, 'image')

	await expect(index.ensureThumbnail(image)).rejects.toThrow('empty or invalid artifact')
	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	await expect(
		fse.pathExists(thumbnailSystemPath(thumbnailDirectory, contentIdentity(digest.toString('hex')))),
	).resolves.toBe(false)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'failed',
		failure_count: 1,
	})
	database.close()
})

test('repairs a zero-length artifact before serving it again', async () => {
	const digest = Buffer.alloc(32, 0x36)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, `thumbnail-${generateThumbnail.mock.calls.length}`)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'truncated.png')
	await writeFile(image, 'image')
	const reference = await index.ensureThumbnail(image)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await fse.outputFile(thumbnail, '')

	await expect(index.getExistingThumbnail(image)).resolves.toBeUndefined()
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.getExistingThumbnail(image)).resolves.toStrictEqual(reference)
			expect((await fse.stat(thumbnail)).size).toBeGreaterThan(0)
		},
		{retries: 100, minTimeout: 10, maxTimeout: 20},
	)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('runs artifact maintenance while an unreadable file is waiting for its hash retry', async () => {
	const hashFile = vi.fn(async () => {
		throw new Error('injected unreadable source')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile}})
	const image = nodePath.join(homeDirectory, 'unreadable.png')
	await writeFile(image, 'unreadable image')
	await index.reconcilePath(image)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()
	const legacyArtifact = nodePath.join(dataDirectory, 'thumbnails', 'legacy-untracked.webp')
	await fse.outputFile(legacyArtifact, 'legacy')

	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({enrichment: {hashFailures: 1, pendingHashes: 1}})
			await expect(fse.pathExists(legacyArtifact)).resolves.toBe(false)
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	expect(hashFile).toHaveBeenCalledOnce()
})

test('settles queued thumbnail requests when the index stops', async () => {
	let releaseGeneration!: () => void
	let signalGeneration!: () => void
	const generationStarted = new Promise<void>((resolve) => (signalGeneration = resolve))
	const generationReleased = new Promise<void>((resolve) => (releaseGeneration = resolve))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		signalGeneration()
		await generationReleased
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => Buffer.alloc(32, 0x78), generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'shutdown.png')
	await writeFile(image, 'image')

	const active = index.ensureThumbnail(image)
	await generationStarted
	const queued = index.ensureThumbnail(image)
	const queuedResult = queued.then(
		() => 'resolved',
		(error: Error) => error.message,
	)
	await new Promise((resolve) => setTimeout(resolve, 10))
	const stopping = index.stop()
	releaseGeneration()

	await expect(active).resolves.toMatchObject({kind: 'content', key: '78'.repeat(32)})
	await expect(queuedResult).resolves.toBe('File enrichment is unavailable')
	await expect(stopping).resolves.toBeUndefined()
})

test('persists hash and thumbnail failures and lets an on-demand retry recover immediately', async () => {
	const hashFile = vi
		.fn()
		.mockRejectedValueOnce(new Error('injected hash read failure'))
		.mockResolvedValue(Buffer.alloc(32, 0x81))
	const generateThumbnail = vi
		.fn(async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'))
		.mockRejectedValueOnce(new Error('injected convert failure'))
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'retry.png')
	await writeFile(image, 'retry image')

	await expect(index.ensureThumbnail(image)).rejects.toThrow('injected hash read failure')
	let database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT hash_failure_count, hash_retry_at, hash_error FROM entries').get()).toMatchObject({
		hash_failure_count: 1,
		hash_retry_at: expect.any(Number),
		hash_error: 'injected hash read failure',
	})
	database.close()

	await expect(index.ensureThumbnail(image)).rejects.toThrow('injected convert failure')
	database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(
		database.prepare('SELECT state, failure_count, retry_at, last_error FROM thumbnail_variants').get(),
	).toMatchObject({
		state: 'failed',
		failure_count: 1,
		retry_at: expect.any(Number),
		last_error: 'injected convert failure',
	})
	database.close()

	await expect(index.ensureThumbnail(image)).resolves.toMatchObject({kind: 'content', key: '81'.repeat(32)})
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
	database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(database.prepare('SELECT hash_failure_count, hash_retry_at, hash_error FROM entries').get()).toStrictEqual({
		hash_failure_count: 0,
		hash_retry_at: null,
		hash_error: null,
	})
	expect(
		database.prepare('SELECT state, failure_count, retry_at, last_error FROM thumbnail_variants').get(),
	).toStrictEqual({
		state: 'ready',
		failure_count: 0,
		retry_at: null,
		last_error: null,
	})
	database.close()
})

test('backs off artifact-side ENOENT failures instead of treating the source as stale', async () => {
	const artifactError = Object.assign(new Error('artifact disappeared during publication'), {code: 'ENOENT'})
	const generateThumbnail = vi.fn().mockRejectedValue(artifactError)
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => Buffer.alloc(32, 0x83), generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'artifact-error.png')
	await writeFile(image, 'image')

	await expect(index.ensureThumbnail(image)).rejects.toThrow('artifact disappeared during publication')

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	expect(
		database.prepare('SELECT state, failure_count, retry_at, last_error FROM thumbnail_variants').get(),
	).toMatchObject({
		state: 'failed',
		failure_count: 1,
		retry_at: expect.any(Number),
		last_error: 'artifact disappeared during publication',
	})
	database.close()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('wakes for a thumbnail retry before a later unrelated hash retry', async () => {
	const hashFile = vi.fn(async (systemPath: string) => {
		if (nodePath.basename(systemPath) === 'hash-retry.png') throw new Error('injected hash failure')
		return Buffer.alloc(32, 0x82)
	})
	const generateThumbnail = vi
		.fn(async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'))
		.mockRejectedValueOnce(new Error('injected thumbnail failure'))
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const thumbnailRetry = nodePath.join(homeDirectory, 'thumbnail-retry.png')
	const hashRetry = nodePath.join(homeDirectory, 'hash-retry.png')
	await Promise.all([writeFile(thumbnailRetry, 'thumbnail'), writeFile(hashRetry, 'hash')])

	await expect(index.ensureThumbnail(thumbnailRetry)).rejects.toThrow('injected thumbnail failure')
	await expect(index.ensureThumbnail(hashRetry)).rejects.toThrow('injected hash failure')
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	const now = Date.now()
	database.prepare("UPDATE thumbnail_variants SET retry_at = ? WHERE state = 'failed'").run(now + 150)
	database.prepare("UPDATE entries SET hash_retry_at = ? WHERE relative_path = 'hash-retry.png'").run(now + 2_000)
	database.close()

	index.startBackgroundReconciliation()
	await pRetry(
		async () =>
			expect(await index.getExistingThumbnail(thumbnailRetry)).toMatchObject({kind: 'content', key: '82'.repeat(32)}),
		{
			retries: 100,
			minTimeout: 10,
			maxTimeout: 20,
		},
	)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('ignores orphaned failed variants when scheduling the next retry wake', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const pending = nodePath.join(homeDirectory, 'future-hash.png')
	await writeFile(pending, 'pending')
	await index.reconcilePath(pending)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.prepare('UPDATE entries SET hash_retry_at = ?').run(Date.now() + 60_000)
	const orphan = database
		.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 1, ?) RETURNING id')
		.get(Buffer.alloc(32, 0x84), Date.now()) as {id: number}
	database
		.prepare(
			`INSERT INTO thumbnail_variants(content_id, variant, state, failure_count, retry_at, updated_at)
			VALUES (?, ?, 'failed', 1, 0, ?)`,
		)
		.run(orphan.id, THUMBNAIL_VARIANT, Date.now())
	database.close()

	const prepare = vi.spyOn(BetterSqlite3.prototype, 'prepare')
	index.startBackgroundReconciliation()
	await vi.waitFor(() =>
		expect(prepare.mock.calls.some(([sql]) => String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'))).toBe(true),
	)
	await new Promise((resolve) => setTimeout(resolve, 50))
	const settledQueryCount = prepare.mock.calls.filter(([sql]) =>
		String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'),
	).length
	await new Promise((resolve) => setTimeout(resolve, 100))
	const schedulerQueries = prepare.mock.calls.filter(([sql]) =>
		String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'),
	)
	expect(schedulerQueries).toHaveLength(settledQueryCount)
})

test('discards stale hash and thumbnail work when the source changes during generation', async () => {
	const digests = [Buffer.alloc(32, 0x91), Buffer.alloc(32, 0x92)]
	const hashFile = vi.fn(async () => digests.shift()!)
	let changeSource = true
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
		if (changeSource) {
			changeSource = false
			await appendFile(source, ' changed during generation')
		}
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'changing-during-generation.png')
	await writeFile(image, 'first revision')

	const reference = await index.ensureThumbnail(image)
	expect(reference.key).toBe('92'.repeat(32))
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	await expect(fse.pathExists(thumbnailSystemPath(thumbnailDirectory, contentIdentity('91'.repeat(32))))).resolves.toBe(
		false,
	)
	await expect(fse.pathExists(thumbnailSystemPath(thumbnailDirectory, reference))).resolves.toBe(true)
	const temporaryFiles = await fse.readdir(
		nodePath.dirname(thumbnailSystemPath(thumbnailDirectory, contentIdentity('91'.repeat(32)))),
	)
	expect(temporaryFiles.some((name) => name.includes('.tmp-'))).toBe(false)
})

test('waits for background sources to be quiet without letting an active writer block stable work', async () => {
	const generationOrder: string[] = []
	const hashFile = vi.fn(async (systemPath: string) =>
		Buffer.alloc(32, nodePath.basename(systemPath).startsWith('active') ? 0xa1 : 0xa2),
	)
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		generationOrder.push(nodePath.basename(source))
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const active = nodePath.join(homeDirectory, 'active.png')
	const stable = nodePath.join(homeDirectory, 'stable.png')
	await Promise.all([writeFile(active, 'active'), writeFile(stable, 'stable')])
	// File timestamps are untrusted metadata: camera clocks and network shares can
	// put them far in the future. Quietness is measured from when this revision was
	// observed, so a future-dated stable file must still be enriched normally.
	const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
	await utimes(stable, future, future)
	await index.reconcileRoot('/Home', 'quiet-period-test')

	// Observe another revision of the active file later. Its persisted quiet
	// deadline moves forward without delaying the already-stable file.
	await new Promise((resolve) => setTimeout(resolve, 500))
	await appendFile(active, ' still-writing')
	await index.reconcilePath(active)

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(generationOrder).toContain('stable.png'), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(generationOrder).toStrictEqual(['stable.png'])
	await pRetry(async () => expect(generationOrder).toStrictEqual(['stable.png', 'active.png']), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
})

test('scores indexed filenames with the established fuzzy matcher', async () => {
	const {index, homeDirectory} = await fixture()
	const decomposedCafe = 'café.jpg'.normalize('NFD')
	const decomposedKorean = '한글.txt'.normalize('NFD')
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'Bitcoin.PDF'), ''),
		writeFile(nodePath.join(homeDirectory, 'vacation-photo.jpg'), ''),
		writeFile(nodePath.join(homeDirectory, 'vacuum-notes.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'unrelated.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcdzzzz.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'holiday.jpg'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcde.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'résumé.pdf'), ''),
		writeFile(nodePath.join(homeDirectory, decomposedCafe), ''),
		writeFile(nodePath.join(homeDirectory, decomposedKorean), ''),
		writeFile(nodePath.join(homeDirectory, 'İstanbul.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'ᎠᎡᎢ.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'ab'), ''),
		writeFile(nodePath.join(homeDirectory, 'Äö'), ''),
		writeFile(nodePath.join(homeDirectory, '.bitcoin-secret.txt'), ''),
		...['olu', 'lud', 'uda', 'ito', 'toc', 'oci', 'cin'].map((name) =>
			writeFile(nodePath.join(homeDirectory, `${name}.txt`), ''),
		),
	])
	await index.reconcileRoot('/Home', 'search-test')

	await expect(candidateNames(index, 'BITCOIN')).resolves.toStrictEqual(['Bitcoin.PDF'])
	await expect(candidateNames(index, 'vacationphoto')).resolves.toStrictEqual(['vacation-photo.jpg'])
	await expect(candidateNames(index, 'bit corn')).resolves.toStrictEqual(['Bitcoin.PDF'])
	await expect(candidateNames(index, 'bitocin')).resolves.toStrictEqual(['Bitcoin.PDF'])
	await expect(candidateNames(index, 'holuday')).resolves.toStrictEqual(['holiday.jpg'])
	await expect(candidateNames(index, 'holi')).resolves.toStrictEqual(['holiday.jpg'])
	await expect(candidateNames(index, 'abcde')).resolves.toStrictEqual(['abcde.txt'])
	await expect(candidateNames(index, 'abxde')).resolves.toStrictEqual([])
	await expect(candidateNames(index, 'resume')).resolves.toStrictEqual(['résumé.pdf'])
	await expect(candidateNames(index, 'café')).resolves.toStrictEqual([decomposedCafe])
	await expect(candidateNames(index, '한글.txt')).resolves.toStrictEqual([decomposedKorean])
	await expect(candidateNames(index, 'İSTAN')).resolves.toStrictEqual(['İstanbul.txt'])
	await expect(candidateNames(index, 'ᎠᎡᎢ')).resolves.toStrictEqual(['ᎠᎡᎢ.txt'])
	await expect(candidateNames(index, 'abcdefgh')).resolves.toStrictEqual([])
	await expect(candidateNames(index, 'completely-nonexistent-query')).resolves.toStrictEqual([])
	await expect(index.searchCandidates('/Home', 'vacaton', 1)).resolves.toMatchObject([{name: 'vacation-photo.jpg'}])
	await expect(index.searchCandidates('/Home', 'ab', 1)).resolves.toMatchObject([{name: 'ab'}])
	await expect(candidateNames(index, 'äö')).resolves.toStrictEqual(['Äö'])
	await expect(index.searchCandidates('/Home', 'abc\0def', 10)).rejects.toThrow('cannot contain NUL')
	await expect(index.searchCandidates('/Home', 'vacation', 250.5)).rejects.toThrow('positive integer')
})

test('uses folded literal substring candidates for one- and two-character searches', async () => {
	const {index, homeDirectory} = await fixture()
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'CV.pdf'), ''),
		writeFile(nodePath.join(homeDirectory, 'myCV.pdf'), ''),
		writeFile(nodePath.join(homeDirectory, 'notes.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'Äö'), ''),
		writeFile(nodePath.join(homeDirectory, 'Äö-decoy.txt'), ''),
	])
	await index.reconcileRoot('/Home', 'short-search-test')

	await expect(candidateNames(index, 'cv')).resolves.toStrictEqual(['CV.pdf', 'myCV.pdf'])
	await expect(candidateNames(index, 'v')).resolves.toStrictEqual(['CV.pdf', 'myCV.pdf'])
	await expect(index.searchCandidates('/Home', 'äö', 1)).resolves.toMatchObject([{name: 'Äö'}])
})

test('ranks indexed exact names ahead of bounded substring candidates', async () => {
	const names = [
		...Array.from({length: 1_200}, (_, index) => `abcdef-decoy-${String(index).padStart(4, '0')}`),
		'abcdef',
		...Array.from({length: 1_200}, (_, index) => `ab-decoy-${String(index).padStart(4, '0')}`),
		'ab',
	]
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		const stats = await lstat(root)
		for (const name of names) yield {systemPath: nodePath.join(root, name), stats}
	}
	const {index} = await fixture(walk)
	await index.reconcileRoot('/Home', 'exact-ranking-test')

	await expect(index.searchCandidates('/Home', 'abcdef', 1)).resolves.toMatchObject([{name: 'abcdef'}])
	await expect(index.searchCandidates('/Home', 'ab', 1)).resolves.toMatchObject([{name: 'ab'}])
})

test('ranks fuzzy results across strict and relaxed FTS candidate phases', async () => {
	const {index, homeDirectory} = await fixture()
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'abcdef'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcxef'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcdcdef'), ''),
	])
	await index.reconcileRoot('/Home', 'search-phase-ranking-test')

	await expect(index.searchCandidates('/Home', 'abcdef', 2)).resolves.toMatchObject([
		{name: 'abcdef'},
		{name: 'abcxef'},
	])
})

test('finds a contiguous match beyond the bounded non-contiguous candidate set', async () => {
	const decoys = Array.from({length: 1_200}, (_, index) => `abc-bcd-cde-def-${String(index).padStart(4, '0')}`)
	const target = 'abcdef-target.txt'
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		const stats = await lstat(root)
		for (const name of [...decoys, target]) yield {systemPath: nodePath.join(root, name), stats}
	}
	const {index} = await fixture(walk)
	await index.reconcileRoot('/Home', 'bounded-substring-candidate-test')

	await expect(index.searchCandidates('/Home', 'abcdef', 1)).resolves.toMatchObject([{name: target}])
})

test('searches partial indexed state while a root is warming', async () => {
	const {index, homeDirectory} = await fixture()
	const warmingPath = nodePath.join(homeDirectory, 'warming-result.txt')
	await writeFile(warmingPath, '')

	await index.reconcilePath(warmingPath)

	await expect(index.status()).resolves.toMatchObject({roots: [{virtualPath: '/Home', state: 'warming'}]})
	await expect(candidateNames(index, 'warming')).resolves.toStrictEqual(['warming-result.txt'])
})

test('searches committed rows while a bulk reconciliation is running', async () => {
	let releaseWalk!: () => void
	let signalPaused!: () => void
	const paused = new Promise<void>((resolve) => (signalPaused = resolve))
	const released = new Promise<void>((resolve) => (releaseWalk = resolve))
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		for await (const entry of walkFileTree(root, stopping)) {
			yield entry
			signalPaused()
			await released
		}
	}
	const {index, homeDirectory} = await fixture(walk, {batchSize: 1})
	await writeFile(nodePath.join(homeDirectory, 'partial-scan-result.txt'), '')

	const scan = index.reconcileRoot('/Home', 'partial-search-test')
	await paused

	try {
		await expect(candidateNames(index, 'partialscan')).resolves.toStrictEqual(['partial-scan-result.txt'])
	} finally {
		releaseWalk()
	}
	await scan
	await expect(candidateNames(index, 'partialscan')).resolves.toStrictEqual(['partial-scan-result.txt'])
})

test('sweeps stale entries only after a successful scan', async () => {
	let failWalk = false
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		let yielded = false
		for await (const entry of walkFileTree(root, stopping)) {
			yield entry
			if (failWalk && !yielded) {
				yielded = true
				throw new Error('simulated read failure')
			}
		}
	}
	const {index, homeDirectory} = await fixture(walk)
	const retainedPath = nodePath.join(homeDirectory, 'retained.txt')
	const otherPath = nodePath.join(homeDirectory, 'other.txt')
	await writeFile(retainedPath, 'retained')
	await writeFile(otherPath, 'other')
	await index.reconcileRoot('/Home', 'initial')
	await fse.remove(retainedPath)

	failWalk = true
	await index.reconcileRoot('/Home', 'failing')
	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toMatchObject({name: 'retained.txt'})
	await expect(index.status()).resolves.toMatchObject({roots: [{virtualPath: '/Home', state: 'degraded'}]})

	failWalk = false
	await index.reconcileRoot('/Home', 'repair')
	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({roots: [{virtualPath: '/Home', state: 'ready'}]})
})

test('sweeps readable paths while preserving an unreadable subtree', async () => {
	let unreadablePath = ''
	let simulateUnreadable = false
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (
		root,
		stopping,
		includePath,
		onPathError,
	) {
		if (!simulateUnreadable) {
			yield* walkFileTree(root, stopping, includePath)
			return
		}

		const error = Object.assign(new Error('simulated permission failure'), {code: 'EACCES'})
		onPathError?.(unreadablePath, error)
		yield* walkFileTree(root, stopping, (systemPath) => {
			if (includePath && !includePath(systemPath)) return false
			return systemPath !== unreadablePath && !systemPath.startsWith(`${unreadablePath}${nodePath.sep}`)
		})
	}
	const {index, homeDirectory} = await fixture(walk)
	unreadablePath = nodePath.join(homeDirectory, 'unreadable_%')
	const retainedPath = nodePath.join(unreadablePath, 'retained.txt')
	const staleReadablePath = nodePath.join(homeDirectory, 'stale-readable.txt')
	const similarReadablePath = nodePath.join(homeDirectory, 'unreadable_%0-sibling.txt')
	const newReadablePath = nodePath.join(homeDirectory, 'new-readable.txt')
	await fse.outputFile(retainedPath, 'retained')
	await writeFile(staleReadablePath, 'stale')
	await writeFile(similarReadablePath, 'similar')
	await index.reconcileRoot('/Home', 'initial')
	const initialStatus = await index.status()
	const initialSuccessfulScanAt = initialStatus.roots[0].lastSuccessfulScanAt

	await fse.remove(retainedPath)
	await fse.remove(staleReadablePath)
	await fse.remove(similarReadablePath)
	await writeFile(newReadablePath, 'new')
	simulateUnreadable = true
	await index.reconcileRoot('/Home', 'partially-unreadable')

	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toMatchObject({name: 'retained.txt'})
	await expect(index.getEntryBySystemPath(staleReadablePath)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(similarReadablePath)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(newReadablePath)).resolves.toMatchObject({name: 'new-readable.txt'})
	await expect(candidateNames(index, 'retained')).resolves.toStrictEqual(['retained.txt'])
	await expect(index.status()).resolves.toMatchObject({
		roots: [
			{
				virtualPath: '/Home',
				state: 'degraded',
				lastSuccessfulScanAt: initialSuccessfulScanAt,
				lastError: expect.stringContaining("Skipped 1 unreadable path: '/Home/unreadable_%' (EACCES"),
			},
		],
	})
	expect(logger.error).toHaveBeenCalledWith(
		expect.stringContaining("Partially reconciled '/Home'"),
		expect.objectContaining({message: expect.stringContaining("'/Home/unreadable_%'")}),
	)

	simulateUnreadable = false
	await index.reconcileRoot('/Home', 'readable-again')
	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({
		roots: [{virtualPath: '/Home', state: 'ready', lastError: undefined}],
	})
})

test('processes a Parcel watcher batch after an active full scan', async () => {
	let releaseWalk!: () => void
	let signalPaused!: () => void
	const paused = new Promise<void>((resolve) => (signalPaused = resolve))
	const released = new Promise<void>((resolve) => (releaseWalk = resolve))
	let shouldPause = true
	let activeWalks = 0
	let maximumActiveWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		activeWalks++
		maximumActiveWalks = Math.max(maximumActiveWalks, activeWalks)
		try {
			for await (const entry of walkFileTree(root, stopping)) {
				yield entry
				if (shouldPause) {
					shouldPause = false
					signalPaused()
					await released
				}
			}
		} finally {
			activeWalks--
		}
	}
	const {index, homeDirectory} = await fixture(walk)
	await writeFile(nodePath.join(homeDirectory, 'first.txt'), 'first')

	const scan = index.reconcileRoot('/Home', 'test-race')
	await paused
	const latePath = nodePath.join(homeDirectory, 'late.txt')
	await writeFile(latePath, 'late')
	// Watchman may report the watched root itself for a subtree change. The
	// already-coalesced Parcel batch waits behind the active scan without
	// overlapping it, then processes both events in order.
	noteWatcherChanges(index, [latePath, homeDirectory])
	releaseWalk()
	await scan

	await pRetry(async () => expect(await index.getEntryBySystemPath(latePath)).toMatchObject({name: 'late.txt'}), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(await candidateNames(index, 'late')).toContain('late.txt')
	expect(maximumActiveWalks).toBe(1)
})

test('applies direct path changes between full-scan batches', async () => {
	let releaseFirstBatch!: () => void
	let releaseLastBatch!: () => void
	let signalWalkStarted!: () => void
	let signalBetweenBatches!: () => void
	const firstBatchReleased = new Promise<void>((resolve) => (releaseFirstBatch = resolve))
	const lastBatchReleased = new Promise<void>((resolve) => (releaseLastBatch = resolve))
	const walkStarted = new Promise<void>((resolve) => (signalWalkStarted = resolve))
	const betweenBatches = new Promise<void>((resolve) => (signalBetweenBatches = resolve))
	let firstPath = ''
	let lastPath = ''
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* () {
		signalWalkStarted()
		await firstBatchReleased
		yield {systemPath: firstPath, stats: await lstat(firstPath)}
		// The generator is resumed only after the scanner has written the first
		// batch and drained its queued live work.
		signalBetweenBatches()
		await lastBatchReleased
		yield {systemPath: lastPath, stats: await lstat(lastPath)}
	}
	const {index, homeDirectory} = await fixture(walk, {batchSize: 1})
	firstPath = nodePath.join(homeDirectory, 'first-batch.txt')
	lastPath = nodePath.join(homeDirectory, 'last-batch.txt')
	const removedPath = nodePath.join(homeDirectory, 'removed-live.txt')
	const createdPath = nodePath.join(homeDirectory, 'created-live.txt')
	await Promise.all([writeFile(firstPath, 'first'), writeFile(lastPath, 'last'), writeFile(removedPath, 'remove')])
	await index.reconcilePath(removedPath)

	const scan = index.reconcileRoot('/Home', 'interleaved-live-work')
	await walkStarted
	await Promise.all([writeFile(createdPath, 'created'), fse.remove(removedPath)])
	const liveChanges = Promise.all([index.reconcilePath(createdPath), index.reconcilePath(removedPath)])
	let scanFinished = false
	void scan.then(() => (scanFinished = true))

	releaseFirstBatch()
	await betweenBatches
	await liveChanges

	expect(scanFinished).toBe(false)
	await expect(index.getEntryBySystemPath(createdPath)).resolves.toMatchObject({name: 'created-live.txt'})
	await expect(index.getEntryBySystemPath(removedPath)).resolves.toBeUndefined()

	releaseLastBatch()
	await scan
	await expect(index.getEntryBySystemPath(createdPath)).resolves.toMatchObject({name: 'created-live.txt'})
	await expect(index.getEntryBySystemPath(removedPath)).resolves.toBeUndefined()
})

test('reruns an active snapshot after watcher recovery requests a full reconciliation', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalkPaused!: () => void
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalkPaused = resolve))
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		if (rootWalks === 1) {
			const oldPath = nodePath.join(root, 'removed-during-recovery.txt')
			yield {systemPath: oldPath, stats: await lstat(oldPath)}
			signalFirstWalkPaused()
			await firstWalkReleased
			return
		}
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk, {batchSize: 1})
	const removedPath = nodePath.join(homeDirectory, 'removed-during-recovery.txt')
	const recoveredPath = nodePath.join(homeDirectory, 'found-after-recovery.txt')
	await writeFile(removedPath, 'old')

	const scan = index.reconcileRoot('/Home', 'watcher-active-before-recovery')
	await firstWalkPaused
	await Promise.all([fse.remove(removedPath), writeFile(recoveredPath, 'new')])
	index.scheduleFullReconciliation('watcher-restarted')
	releaseFirstWalk()
	await scan

	expect(rootWalks).toBe(2)
	await expect(index.getEntryBySystemPath(removedPath)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(recoveredPath)).resolves.toMatchObject({name: 'found-after-recovery.txt'})
})

test('collapses large Parcel batches during a scan into one follow-up snapshot', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		if (rootWalks === 1) {
			for (const name of ['first.txt', 'removed-during-retry.txt']) {
				const systemPath = nodePath.join(root, name)
				yield {systemPath, stats: await lstat(systemPath)}
			}
			signalFirstWalk()
			await firstWalkReleased
			return
		}
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk, {watcherBulkThreshold: 2})
	await writeFile(nodePath.join(homeDirectory, 'first.txt'), 'first')
	const removedDuringRetry = nodePath.join(homeDirectory, 'removed-during-retry.txt')
	await writeFile(removedDuringRetry, 'removed')

	const scan = index.reconcileRoot('/Home', 'burst-during-scan')
	await firstWalkPaused
	await fse.remove(removedDuringRetry)
	const latePaths = ['late-a.txt', 'late-b.txt', 'late-c.txt', 'late-d.txt'].map((name) =>
		nodePath.join(homeDirectory, name),
	)
	await Promise.all(latePaths.map((path) => writeFile(path, 'late')))
	noteWatcherChanges(index, latePaths.slice(0, 2))
	noteWatcherChanges(index, latePaths.slice(2))
	releaseFirstWalk()
	await scan

	await pRetry(
		async () =>
			expect(await candidateNames(index, 'late')).toStrictEqual([
				'late-a.txt',
				'late-b.txt',
				'late-c.txt',
				'late-d.txt',
			]),
		{retries: 20, minTimeout: 10, maxTimeout: 20},
	)
	expect(rootWalks).toBe(2)
	await expect(index.getEntryBySystemPath(removedDuringRetry)).resolves.toBeUndefined()
})

test('processes already-coalesced Parcel batches for creates and deletes', async () => {
	const {index, homeDirectory} = await fixture()
	await index.reconcileRoot('/Home', 'initial')
	const directory = nodePath.join(homeDirectory, 'new-directory')
	const file = nodePath.join(directory, 'event.txt')
	await fse.ensureDir(directory)
	await writeFile(file, 'one')
	noteWatcherChanges(index, [file, directory])

	await pRetry(async () => expect(await index.getEntryBySystemPath(file)).toMatchObject({name: 'event.txt', size: 3}), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})

	await fse.remove(file)
	noteWatcherChanges(index, [file], 'delete')
	await pRetry(async () => expect(await index.getEntryBySystemPath(file)).toBeUndefined(), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
})

test('does not turn directory update events into repeated root scans', async () => {
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk)
	const directories = Array.from({length: 20}, (_, number) => nodePath.join(homeDirectory, `directory-${number}`))
	await Promise.all(directories.map((directory) => fse.ensureDir(directory)))
	const file = nodePath.join(directories.at(-1)!, 'event.txt')
	await writeFile(file, 'old')
	await index.reconcileRoot('/Home', 'initial')

	await writeFile(file, 'new content')
	index.noteWatcherChanges('/Home', [
		...directories.map((path) => ({path, type: 'update' as const})),
		{path: file, type: 'update'},
	])

	await pRetry(async () => expect(await index.getEntryBySystemPath(file)).toMatchObject({size: 11}), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(rootWalks).toBe(1)
})

test('removes every indexed descendant of a deleted Unicode directory', async () => {
	const {index, homeDirectory} = await fixture()
	const directory = nodePath.join(homeDirectory, 'emoji-😀')
	const child = nodePath.join(directory, 'child.txt')
	const grandchild = nodePath.join(directory, 'nested', 'grandchild.txt')
	const lowerSibling = nodePath.join(homeDirectory, 'emoji-😀.txt')
	const upperSibling = nodePath.join(homeDirectory, 'emoji-😀0.txt')
	await fse.ensureDir(nodePath.dirname(grandchild))
	await Promise.all([
		writeFile(child, 'child'),
		writeFile(grandchild, 'grandchild'),
		writeFile(lowerSibling, 'lower'),
		writeFile(upperSibling, 'upper'),
	])
	await index.reconcileRoot('/Home', 'unicode-delete-test')

	await fse.remove(directory)
	noteWatcherChanges(index, [directory], 'delete')

	await pRetry(async () => expect(await index.getEntryBySystemPath(child)).toBeUndefined(), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.getEntryBySystemPath(grandchild)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(lowerSibling)).resolves.toMatchObject({name: 'emoji-😀.txt'})
	await expect(index.getEntryBySystemPath(upperSibling)).resolves.toMatchObject({name: 'emoji-😀0.txt'})
	await expect(candidateNames(index, 'grandchild')).resolves.toStrictEqual([])
})

test('uses one root snapshot for a large watcher burst', async () => {
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk, {watcherBulkThreshold: 3})
	const paths = Array.from({length: 3}, (_, number) => nodePath.join(homeDirectory, `burst-${number}.txt`))
	await Promise.all(paths.map((path) => writeFile(path, 'burst')))
	noteWatcherChanges(index, paths)

	await pRetry(async () => expect(await index.status()).toMatchObject({entryCount: 3}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(rootWalks).toBe(1)
	expect(logger.log).toHaveBeenCalledWith("Reconciling '/Home' (watcher-burst)")
})

test('uses a full root reconciliation for a watcher directory creation', async () => {
	const entryCount = 2_000
	const walkedRoots: string[] = []
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		walkedRoots.push(root)
		const stats = await lstat(root)
		for (let index = 0; index < entryCount; index++) {
			yield {systemPath: nodePath.join(root, `watcher-bulk-${String(index).padStart(4, '0')}`), stats}
		}
	}
	const {index, homeDirectory} = await fixture(walk)
	const changedDirectory = nodePath.join(homeDirectory, 'watcher-directory')
	await fse.ensureDir(changedDirectory)

	noteWatcherChanges(index, [changedDirectory])

	await pRetry(async () => expect(await index.status()).toMatchObject({entryCount}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(walkedRoots).toStrictEqual([homeDirectory])
	expect(logger.log).toHaveBeenCalledWith("Reconciling '/Home' (directory-changed)")
}, 10_000)

test('applies direct move hints to both paths, including regular files', async () => {
	const {index, homeDirectory} = await fixture()
	const source = nodePath.join(homeDirectory, 'before.txt')
	const destination = nodePath.join(homeDirectory, 'after.txt')
	await writeFile(source, 'moved')
	await index.reconcileRoot('/Home', 'initial')
	await fse.move(source, destination)

	await index.movePath(source, destination)

	await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(destination)).resolves.toMatchObject({name: 'after.txt', size: 5})
	await expect(candidateNames(index, 'before')).resolves.toStrictEqual([])
	await expect(candidateNames(index, 'after')).resolves.toStrictEqual(['after.txt'])
})

test('removes a stale move source even when destination reconciliation fails', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const source = nodePath.join(homeDirectory, 'before.txt')
	const destination = nodePath.join(homeDirectory, 'after.txt')
	await writeFile(source, 'moved')
	await index.reconcilePath(source)
	await fse.move(source, destination)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))
	database.exec(`
		CREATE TRIGGER reject_move_destination BEFORE INSERT ON entries
		WHEN NEW.relative_path = 'after.txt'
		BEGIN
			SELECT RAISE(ABORT, 'injected destination reconciliation failure');
		END
	`)
	database.close()

	await expect(index.movePath(source, destination)).rejects.toThrow('injected destination reconciliation failure')
	await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
})

test('converges concurrent direct hints through serial mutations', async () => {
	const {index, homeDirectory} = await fixture()
	const moves = Array.from({length: 40}, (_, index) => ({
		source: nodePath.join(homeDirectory, `before-${index}.txt`),
		destination: nodePath.join(homeDirectory, `after-${index}.txt`),
	}))
	await Promise.all(moves.map(({source}) => writeFile(source, 'moved')))
	await index.reconcileRoot('/Home', 'initial')
	await Promise.all(moves.map(({source, destination}) => fse.move(source, destination)))

	await Promise.all(moves.map(({source, destination}) => index.movePath(source, destination)))

	await expect(index.status()).resolves.toMatchObject({entryCount: moves.length})
	for (const {source, destination} of moves) {
		await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
		await expect(index.getEntryBySystemPath(destination)).resolves.toMatchObject({type: 'file', size: 5})
	}
})

test('drains queued direct hints while stopping', async () => {
	const {index, homeDirectory} = await fixture(undefined, {batchSize: 1})
	const moves = Array.from({length: 40}, (_, entry) => ({
		source: nodePath.join(homeDirectory, `queued-before-${entry}.txt`),
		destination: nodePath.join(homeDirectory, `queued-after-${entry}.txt`),
	}))
	await Promise.all(moves.map(({source}) => writeFile(source, 'moved')))
	await index.reconcileRoot('/Home', 'initial')
	await Promise.all(moves.map(({source, destination}) => fse.move(source, destination)))

	const hints = moves.map(({source, destination}) => index.movePath(source, destination))
	await new Promise<void>((resolve) => setImmediate(resolve))

	await expect(index.stop()).resolves.toBeUndefined()
	await expect(Promise.all(hints)).resolves.toHaveLength(moves.length)
})

test('persists every entry from a large scan', async () => {
	const entryCount = 20_000
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		const stats = await lstat(root)
		for (let index = 0; index < entryCount; index++) {
			yield {systemPath: nodePath.join(root, `bulk-${String(index).padStart(5, '0')}`), stats}
		}
	}
	const {index} = await fixture(walk)

	await index.reconcileRoot('/Home', 'large-scan')

	await expect(index.status()).resolves.toMatchObject({entryCount})
}, 30_000)

test('coalesces repeated requests during a scan into one serial rerun', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	const firstWalkStarted = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	let walks = 0
	let activeWalks = 0
	let maximumActiveWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		walks++
		activeWalks++
		maximumActiveWalks = Math.max(maximumActiveWalks, activeWalks)
		try {
			if (walks === 1) {
				signalFirstWalk()
				await firstWalkReleased
			}
			for await (const entry of walkFileTree(root, stopping)) yield entry
		} finally {
			activeWalks--
		}
	}
	const {index} = await fixture(walk)

	const first = index.reconcileRoot('/Home', 'one')
	await firstWalkStarted
	const second = index.reconcileRoot('/Home', 'two')
	const third = index.reconcileRoot('/Home', 'three')
	releaseFirstWalk()
	await Promise.all([first, second, third])

	expect(walks).toBe(2)
	expect(maximumActiveWalks).toBe(1)
})

test('restarts a cancelled scan when its root changes', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	let walks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		walks++
		for await (const entry of walkFileTree(root, stopping)) yield entry
		if (walks === 1) {
			signalFirstWalk()
			await firstWalkReleased
		}
	}
	const {index, root, rootDirectory, homeDirectory} = await fixture(walk)
	await writeFile(nodePath.join(homeDirectory, 'old-root.txt'), 'old')
	const replacementDirectory = nodePath.join(rootDirectory, 'replacement')
	await fse.ensureDir(replacementDirectory)
	const replacementFile = nodePath.join(replacementDirectory, 'replacement-root.txt')
	await writeFile(replacementFile, 'replacement')

	const firstScan = index.reconcileRoot('/Home', 'old-root')
	await firstWalkPaused
	await index.setRoots([{...root, systemPath: replacementDirectory}])
	releaseFirstWalk()
	await firstScan

	expect(walks).toBe(2)
	await expect(index.getEntryBySystemPath(nodePath.join(homeDirectory, 'old-root.txt'))).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(replacementFile)).resolves.toMatchObject({name: 'replacement-root.txt'})
	await expect(candidateNames(index, 'replacementroot')).resolves.toStrictEqual(['replacement-root.txt'])
})

test('stops a queued rerun when its root is removed during an active scan', async () => {
	let releaseWalk!: () => void
	let signalWalkStarted!: () => void
	const walkReleased = new Promise<void>((resolve) => (releaseWalk = resolve))
	const walkStarted = new Promise<void>((resolve) => (signalWalkStarted = resolve))
	let walks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* () {
		walks++
		signalWalkStarted()
		await walkReleased
	}
	const {index} = await fixture(walk)

	const firstScan = index.reconcileRoot('/Home', 'active-before-removal')
	await walkStarted
	const queuedRerun = index.reconcileRoot('/Home', 'queued-before-removal')
	await index.removeRoot('/Home')
	releaseWalk()

	await Promise.all([firstScan, queuedRerun])
	expect(walks).toBe(1)
	await expect(index.status()).resolves.toMatchObject({entryCount: 0, roots: []})
})

test('keeps an active root scan alive while another root is added', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	let shouldPause = true
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		for await (const entry of walkFileTree(root, stopping)) {
			yield entry
			if (shouldPause) {
				shouldPause = false
				signalFirstWalk()
				await firstWalkReleased
			}
		}
	}
	const {index, rootDirectory, homeDirectory} = await fixture(walk)
	const homeFile = nodePath.join(homeDirectory, 'home-scan-survives.txt')
	await writeFile(homeFile, 'home')
	const memberDirectory = nodePath.join(rootDirectory, 'member-home')
	await fse.ensureDir(memberDirectory)
	await writeFile(nodePath.join(memberDirectory, 'member.txt'), 'member')

	const homeScan = index.reconcileRoot('/Home', 'active-before-root-add')
	await firstWalkPaused
	await index.addRoot({
		virtualPath: '/Users/alice',
		systemPath: memberDirectory,
		ownerId: 'alice',
		kind: 'home',
		searchEnabled: true,
	})
	releaseFirstWalk()
	await homeScan

	await expect(index.getEntryBySystemPath(homeFile)).resolves.toMatchObject({name: 'home-scan-survives.txt'})
	await expect(index.status()).resolves.toMatchObject({
		roots: expect.arrayContaining([expect.objectContaining({virtualPath: '/Home', state: 'ready'})]),
	})
})

test('excludes the reserved Trash subtree from member-home indexing', async () => {
	const {index, rootDirectory} = await fixture()
	const memberHome = nodePath.join(rootDirectory, 'member-home')
	const reservedHomeTrash = nodePath.join(memberHome, 'Trash')
	const memberTrash = nodePath.join(rootDirectory, 'member-trash')
	const visibleFile = nodePath.join(memberHome, 'visible.txt')
	const shadowedFile = nodePath.join(reservedHomeTrash, 'shadowed.txt')
	const realTrashFile = nodePath.join(memberTrash, 'trashed.txt')
	await Promise.all([fse.ensureDir(reservedHomeTrash), fse.ensureDir(memberTrash)])
	await Promise.all([
		writeFile(visibleFile, 'visible'),
		writeFile(shadowedFile, 'shadowed'),
		writeFile(realTrashFile, 'trashed'),
	])
	await index.addRoot({
		virtualPath: '/Users/alice',
		systemPath: memberHome,
		ownerId: 'alice',
		kind: 'home',
		searchEnabled: true,
	})
	await index.addRoot({
		virtualPath: '/Users/alice/Trash',
		systemPath: memberTrash,
		ownerId: 'alice',
		kind: 'trash',
		searchEnabled: false,
	})

	await index.reconcileRoot('/Users/alice', 'member-home-with-reserved-trash')
	await index.reconcileRoot('/Users/alice/Trash', 'member-trash')

	// A pre-fix database may retain this row until its first successful sweep.
	// Reads must reject it immediately, and a direct hint must purge it.
	const database = new BetterSqlite3(index.databasePath)
	const memberHomeRoot = database.prepare("SELECT id FROM index_roots WHERE virtual_path = '/Users/alice'").get() as {
		id: number
	}
	database
		.prepare(
			`INSERT INTO entries(
				root_id, relative_path, name, search_name, search_name_folded,
				type, size, modified_ms, hidden
			) VALUES (?, 'Trash/shadowed.txt', 'shadowed.txt', 'shadowed.txt', 'shadowed.txt', 'file', 8, 1, 0)`,
		)
		.run(memberHomeRoot.id)
	database.close()

	await expect(index.searchCandidates('/Users/alice', 'visible', 10)).resolves.toMatchObject([{name: 'visible.txt'}])
	await expect(index.searchCandidates('/Users/alice', 'shadowed', 10)).resolves.toStrictEqual([])
	await expect(index.getEntryBySystemPath(shadowedFile)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(realTrashFile)).resolves.toMatchObject({name: 'trashed.txt'})

	const laterShadowedFile = nodePath.join(reservedHomeTrash, 'later-shadowed.txt')
	await writeFile(laterShadowedFile, 'later')
	await index.reconcilePath(reservedHomeTrash)
	await expect(index.getEntryBySystemPath(laterShadowedFile)).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({entryCount: 2})
})

test('runs periodic reconciliation serially', async () => {
	let walks = 0
	let activeWalks = 0
	let maximumActiveWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* () {
		walks++
		activeWalks++
		maximumActiveWalks = Math.max(maximumActiveWalks, activeWalks)
		try {
			await new Promise((resolve) => setTimeout(resolve, 10))
		} finally {
			activeWalks--
		}
	}
	const {index} = await fixture(walk, {reconciliationIntervalMs: 5})

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(walks).toBeGreaterThanOrEqual(3), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 10,
	})

	expect(maximumActiveWalks).toBe(1)
})

test('persists entries and removes stale member roots on restart', async () => {
	const {index, dataDirectory, homeDirectory, rootDirectory} = await fixture()
	const memberDirectory = nodePath.join(rootDirectory, 'member')
	const file = nodePath.join(homeDirectory, 'persistent.txt')
	const memberFile = nodePath.join(memberDirectory, 'member.txt')
	await fse.ensureDir(memberDirectory)
	await writeFile(file, 'persistent')
	await writeFile(memberFile, 'member')
	await index.addRoot({
		virtualPath: '/Users/member',
		systemPath: memberDirectory,
		ownerId: 'member',
		kind: 'home',
		searchEnabled: true,
	})
	await index.reconcileRoot('/Home', 'initial')
	await index.reconcileRoot('/Users/member', 'initial')
	await expect(index.status()).resolves.toMatchObject({entryCount: 2})
	await index.stop()
	indexes.splice(indexes.indexOf(index), 1)

	const reopened = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(reopened)
	await reopened.start()
	await reopened.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])

	await expect(reopened.getEntryBySystemPath(file)).resolves.toMatchObject({name: 'persistent.txt'})
	await expect(reopened.status()).resolves.toMatchObject({entryCount: 1, roots: [{virtualPath: '/Home'}]})
})

test('removes populated roots and searches after re-adding them', async () => {
	const {index, root, homeDirectory} = await fixture()
	await Promise.all(
		Array.from({length: 100}, (_, number) =>
			writeFile(nodePath.join(homeDirectory, `before-root-removal-${number}.txt`), 'before'),
		),
	)
	await index.reconcileRoot('/Home', 'before-root-removal')

	await index.removeRoot('/Home')
	await expect(index.status()).resolves.toMatchObject({entryCount: 0, roots: []})

	await writeFile(nodePath.join(homeDirectory, 'after-root-removal.txt'), 'after')
	await index.addRoot(root)
	await index.reconcileRoot('/Home', 'after-root-removal')
	expect(await candidateNames(index, 'afterrootremoval')).toContain('after-root-removal.txt')
})

test('quarantines a corrupt derived database and starts cleanly', async () => {
	const dataDirectory = await temporary.create()
	const databaseDirectory = nodePath.join(dataDirectory, 'file-index')
	const databasePath = nodePath.join(databaseDirectory, 'index.sqlite3')
	await fse.ensureDir(databaseDirectory)
	await writeFile(databasePath, 'not a database')
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(index)

	await index.start()

	await expect(index.status()).resolves.toMatchObject({available: true, schemaVersion: FILE_INDEX_SCHEMA_VERSION})
	const files = await fse.readdir(databaseDirectory)
	expect(files.some((name) => name.startsWith('index.sqlite3.corrupt-'))).toBe(true)
})

test('quarantines a newer pre-release schema and starts cleanly', async () => {
	const dataDirectory = await temporary.create()
	const databaseDirectory = nodePath.join(dataDirectory, 'file-index')
	const databasePath = nodePath.join(databaseDirectory, 'index.sqlite3')
	await fse.ensureDir(databaseDirectory)
	const database = new BetterSqlite3(databasePath)
	await migrateFileIndex(database)
	database
		.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
		.run(FILE_INDEX_SCHEMA_VERSION + 1, Date.now())
	database.close()
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(index)

	await index.start()

	await expect(index.status()).resolves.toMatchObject({
		available: true,
		schemaVersion: FILE_INDEX_SCHEMA_VERSION,
		entryCount: 0,
	})
	const files = await fse.readdir(databaseDirectory)
	expect(files.some((name) => name.startsWith('index.sqlite3.unsupported-schema-'))).toBe(true)
})

test('recovers from a non-corruption open failure without restarting', async () => {
	const dataDirectory = await temporary.create()
	const blockingPath = nodePath.join(dataDirectory, 'file-index')
	await writeFile(blockingPath, 'blocks the database directory')
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false, recoveryRetryMs: 5})
	indexes.push(index)

	await index.start()
	await expect(index.status()).resolves.toMatchObject({available: false})
	await fse.remove(blockingPath)

	await pRetry(
		async () => expect(await index.status()).toMatchObject({available: true, schemaVersion: FILE_INDEX_SCHEMA_VERSION}),
		{
			retries: 20,
			minTimeout: 10,
			maxTimeout: 10,
		},
	)
	expect(logger.log).toHaveBeenCalledWith('Recovered file index database')
})
