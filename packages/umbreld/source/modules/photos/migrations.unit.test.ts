import BetterSqlite3 from 'better-sqlite3'
import {expect, test} from 'vitest'

import {
	migratePhotos,
	PHOTOS_MIGRATION_MODULE,
	PHOTOS_SCHEMA_VERSION,
	UnsupportedPhotosSchemaError,
} from './migrations.js'

test('creates and idempotently migrates the durable Photos schema', () => {
	const database = new BetterSqlite3(':memory:')
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database
			.prepare('PRAGMA table_info(photos_content_state)')
			.all()
			.map((column: any) => column.name),
	).toStrictEqual(['account_id', 'content_hash', 'source_id', 'is_favorite', 'imported_at'])
	expect(
		database.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_deletion_targets'").get(),
	).toBeUndefined()
	expect(
		database.prepare('SELECT module, version FROM schema_migrations ORDER BY module, version').all(),
	).toStrictEqual([
		{module: PHOTOS_MIGRATION_MODULE, version: 1},
		{module: PHOTOS_MIGRATION_MODULE, version: 2},
	])
	expect(
		database
			.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'index') AND name LIKE 'photos_%' ORDER BY name")
			.all(),
	).toStrictEqual([
		{name: 'photos_album_items'},
		{name: 'photos_albums'},
		{name: 'photos_albums_by_account'},
		{name: 'photos_content_state'},
		{name: 'photos_content_state_by_account'},
		{name: 'photos_live_pairs'},
		{name: 'photos_live_pairs_by_motion'},
		{name: 'photos_sources'},
		{name: 'photos_sources_one_umbrel_per_account'},
	])
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'items'").get()).toBeUndefined()
	database.close()
})

test('stores durable Photos state and album membership by 32-byte content hash', () => {
	const database = new BetterSqlite3(':memory:')
	migratePhotos(database)
	const hash = Buffer.alloc(32, 0xab)
	database
		.prepare(
			"INSERT INTO photos_sources(id, account_id, type, name, created_at) VALUES ('source', 'alice', 'umbrel', 'Umbrel', 1)",
		)
		.run()
	database
		.prepare(
			`INSERT INTO photos_content_state(account_id, content_hash, source_id, is_favorite, imported_at)
			VALUES ('alice', ?, 'source', 1, 2)`,
		)
		.run(hash)
	database
		.prepare(
			"INSERT INTO photos_albums(id, account_id, name, cover_content_hash, created_at) VALUES ('album', 'alice', 'Kept', ?, 4)",
		)
		.run(hash)
	database.prepare("INSERT INTO photos_album_items(album_id, content_hash, added_at) VALUES ('album', ?, 5)").run(hash)
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database.prepare('SELECT is_favorite, imported_at FROM photos_content_state WHERE content_hash = ?').get(hash),
	).toStrictEqual({is_favorite: 1, imported_at: 2})
	expect(
		database.prepare('SELECT album_id, hex(content_hash) AS content_hash FROM photos_album_items').all(),
	).toStrictEqual([{album_id: 'album', content_hash: hash.toString('hex').toUpperCase()}])
	database.close()
})

test('migrates v1 state while discarding obsolete deletion markers', () => {
	const database = new BetterSqlite3(':memory:')
	const hash = Buffer.alloc(32, 0xcd)
	database.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('photos', 1, 1);
		CREATE TABLE photos_sources(
			id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		INSERT INTO photos_sources VALUES ('source', 'alice', 'umbrel', 'Umbrel', 1);
		CREATE TABLE photos_content_state(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			source_id TEXT NOT NULL REFERENCES photos_sources(id),
			is_favorite INTEGER NOT NULL,
			deleted_at INTEGER,
			imported_at INTEGER NOT NULL,
			PRIMARY KEY(account_id, content_hash)
		) WITHOUT ROWID;
		CREATE INDEX photos_content_state_by_account
			ON photos_content_state(account_id, is_favorite, deleted_at, content_hash);
		CREATE TABLE photos_deletion_targets(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			virtual_path TEXT NOT NULL,
			PRIMARY KEY(account_id, content_hash, virtual_path),
			FOREIGN KEY(account_id, content_hash)
				REFERENCES photos_content_state(account_id, content_hash) ON DELETE CASCADE
		) WITHOUT ROWID;
	`)
	database
		.prepare(
			`INSERT INTO photos_content_state(account_id, content_hash, source_id, is_favorite, deleted_at, imported_at)
			VALUES ('alice', ?, 'source', 1, 123, 2)`,
		)
		.run(hash)
	database.prepare("INSERT INTO photos_deletion_targets VALUES ('alice', ?, '/Home/photo.jpg')").run(hash)

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(database.prepare('PRAGMA table_info(photos_content_state)').all()).not.toEqual(
		expect.arrayContaining([expect.objectContaining({name: 'deleted_at'})]),
	)
	expect(
		database.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_deletion_targets'").get(),
	).toBeUndefined()
	expect(
		database
			.prepare('SELECT source_id, is_favorite, imported_at FROM photos_content_state WHERE content_hash = ?')
			.get(hash),
	).toStrictEqual({source_id: 'source', is_favorite: 1, imported_at: 2})
	database.close()
})

test('keeps Photos migration versions independent from other umbrel.db modules', () => {
	const database = new BetterSqlite3(':memory:')
	database.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('future-module', 999, 1);
	`)
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database.prepare('SELECT module, version FROM schema_migrations ORDER BY module, version').all(),
	).toStrictEqual([
		{module: 'future-module', version: 999},
		{module: PHOTOS_MIGRATION_MODULE, version: 1},
		{module: PHOTOS_MIGRATION_MODULE, version: 2},
	])
	database.close()
})

test('rejects a database created by a newer Photos version before changing it', () => {
	const database = new BetterSqlite3(':memory:')
	database.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('photos', 999, 1);
	`)
	expect(() => migratePhotos(database)).toThrow(UnsupportedPhotosSchemaError)
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'items'").get()).toBeUndefined()
	database.close()
})
