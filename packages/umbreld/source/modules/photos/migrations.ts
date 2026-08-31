import type BetterSqlite3 from 'better-sqlite3'

export const PHOTOS_SCHEMA_VERSION = 2
export const PHOTOS_MIGRATION_MODULE = 'photos'

export class UnsupportedPhotosSchemaError extends Error {}

export function migratePhotos(database: BetterSqlite3.Database) {
	database.pragma('journal_mode = WAL')
	database.pragma('foreign_keys = ON')
	const migrate = database.transaction(() => {
		database.exec(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				module TEXT NOT NULL,
				version INTEGER NOT NULL,
				applied_at INTEGER NOT NULL,
				PRIMARY KEY(module, version)
			);`)
		const version = Number(
			(
				database
					.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE module = ?')
					.get(PHOTOS_MIGRATION_MODULE) as {
					version: number
				}
			).version,
		)
		if (version > PHOTOS_SCHEMA_VERSION) {
			throw new UnsupportedPhotosSchemaError(
				`Unsupported Photos schema v${version}; expected at most v${PHOTOS_SCHEMA_VERSION}`,
			)
		}
		if (version === PHOTOS_SCHEMA_VERSION) return
		if (version < 1) {
			database.exec(`
			CREATE TABLE photos_sources (
				id TEXT PRIMARY KEY,
				account_id TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('umbrel', 'iphone')),
				name TEXT NOT NULL,
				scope_mode TEXT CHECK (scope_mode IN ('everything', 'everything-except', 'only')),
				scope_paths TEXT,
				last_import_at INTEGER,
				created_at INTEGER NOT NULL
			);
			CREATE UNIQUE INDEX photos_sources_one_umbrel_per_account
				ON photos_sources(account_id) WHERE type = 'umbrel';

			CREATE TABLE photos_content_state (
				account_id TEXT NOT NULL,
				content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
				source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE RESTRICT,
				is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
				imported_at INTEGER NOT NULL,
				PRIMARY KEY(account_id, content_hash)
			) WITHOUT ROWID;
			CREATE INDEX photos_content_state_by_account
				ON photos_content_state(account_id, is_favorite, content_hash);

			CREATE TABLE photos_albums (
				id TEXT PRIMARY KEY,
				account_id TEXT NOT NULL,
				name TEXT NOT NULL,
				cover_content_hash BLOB CHECK (cover_content_hash IS NULL OR length(cover_content_hash) = 32),
				created_at INTEGER NOT NULL
			);
			CREATE INDEX photos_albums_by_account ON photos_albums(account_id, created_at, id);

			CREATE TABLE photos_album_items (
				album_id TEXT NOT NULL REFERENCES photos_albums(id) ON DELETE CASCADE,
				content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
				added_at INTEGER NOT NULL,
				PRIMARY KEY(album_id, content_hash)
			) WITHOUT ROWID;

			CREATE TABLE photos_live_pairs (
				account_id TEXT NOT NULL,
				still_hash BLOB NOT NULL CHECK (length(still_hash) = 32),
				motion_hash BLOB NOT NULL CHECK (length(motion_hash) = 32),
				updated_at INTEGER NOT NULL,
				PRIMARY KEY(account_id, still_hash)
			) WITHOUT ROWID;
			CREATE INDEX photos_live_pairs_by_motion ON photos_live_pairs(account_id, motion_hash);
			`)
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 1, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version === 1) {
			// v1 represented Photos deletion as durable metadata while leaving the
			// original file in Home. Trash is now the source of truth, so retain the
			// unrelated per-content state and discard the obsolete tombstones.
			database.exec(`
				DROP TABLE photos_deletion_targets;
				DROP INDEX photos_content_state_by_account;
				CREATE TABLE photos_content_state_v2 (
					account_id TEXT NOT NULL,
					content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
					source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE RESTRICT,
					is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
					imported_at INTEGER NOT NULL,
					PRIMARY KEY(account_id, content_hash)
				) WITHOUT ROWID;
				INSERT INTO photos_content_state_v2(account_id, content_hash, source_id, is_favorite, imported_at)
					SELECT account_id, content_hash, source_id, is_favorite, imported_at FROM photos_content_state;
				DROP TABLE photos_content_state;
				ALTER TABLE photos_content_state_v2 RENAME TO photos_content_state;
				CREATE INDEX photos_content_state_by_account
					ON photos_content_state(account_id, is_favorite, content_hash);
			`)
		}
		database
			.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 2, ?)')
			.run(PHOTOS_MIGRATION_MODULE, Date.now())
	})
	migrate.immediate()
	return PHOTOS_SCHEMA_VERSION
}
