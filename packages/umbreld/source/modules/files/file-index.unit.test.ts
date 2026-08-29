import nodePath from 'node:path'
import {lstat, symlink, utimes, writeFile} from 'node:fs/promises'

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
		Pick<FileIndexEngineOptions, 'reconciliationIntervalMs' | 'watcherBulkThreshold' | 'batchSize'>
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

describe('file index migrations', () => {
	test('migrates fresh and already-migrated databases', async () => {
		const database = new BetterSqlite3(':memory:')
		await expect(migrateFileIndex(database)).resolves.toBe(6)
		await expect(migrateFileIndex(database)).resolves.toBe(6)
		expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toMatchObject({count: 6})
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
		])
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

		await expect(migrateFileIndex(database)).resolves.toBe(6)
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

		await expect(migrateFileIndex(database)).resolves.toBe(6)
		expect(database.prepare('SELECT name, search_name, search_name_folded FROM entries').get()).toStrictEqual({
			name: decomposedName,
			search_name: 'Café.jpg',
			search_name_folded: 'café.jpg',
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
