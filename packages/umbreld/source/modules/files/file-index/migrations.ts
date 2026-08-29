import type BetterSqlite3 from 'better-sqlite3'

export type FileIndexMigration = {
	version: number
	up: (database: BetterSqlite3.Database) => void
}

export function foldSearchName(value: string) {
	return value.normalize('NFC').toLowerCase()
}

export const fileIndexMigrations: FileIndexMigration[] = [
	{
		version: 1,
		up: (database) => {
			database.exec(`
				CREATE TABLE index_roots (
					id INTEGER PRIMARY KEY,
					virtual_path TEXT NOT NULL UNIQUE,
					system_path TEXT NOT NULL UNIQUE,
					owner_id TEXT NOT NULL,
					kind TEXT NOT NULL CHECK (kind IN ('home', 'trash', 'apps', 'machines')),
					search_enabled INTEGER NOT NULL CHECK (search_enabled IN (0, 1)),
					state TEXT NOT NULL DEFAULT 'warming' CHECK (state IN ('warming', 'ready', 'degraded')),
					scan_generation INTEGER NOT NULL DEFAULT 0,
					last_successful_scan_at INTEGER,
					last_error TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);

				CREATE TABLE entries (
					id INTEGER PRIMARY KEY,
					root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
					relative_path TEXT NOT NULL,
					parent_relative_path TEXT NOT NULL,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK (type IN (
						'directory',
						'symbolic-link',
						'socket',
						'block-device',
						'character-device',
						'fifo',
						'file'
					)),
					mime_type TEXT,
					size INTEGER NOT NULL,
					modified_ms INTEGER NOT NULL,
					changed_ms INTEGER NOT NULL,
					birth_ms INTEGER NOT NULL,
					device INTEGER NOT NULL,
					inode INTEGER NOT NULL,
					mode INTEGER NOT NULL,
					uid INTEGER NOT NULL,
					gid INTEGER NOT NULL,
					nlink INTEGER NOT NULL,
					hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
					last_seen_generation INTEGER NOT NULL,
					indexed_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					UNIQUE(root_id, relative_path)
				);

				CREATE INDEX entries_by_parent ON entries(root_id, parent_relative_path);
				CREATE INDEX entries_by_name ON entries(root_id, name);
				CREATE INDEX entries_by_inode ON entries(root_id, device, inode);
				CREATE INDEX entries_by_generation ON entries(root_id, last_seen_generation);
			`)
		},
	},
	{
		version: 2,
		up: (database) => {
			database.exec(`
				CREATE TABLE entries_v2 (
					id INTEGER PRIMARY KEY,
					root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
					relative_path TEXT NOT NULL,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK (type IN (
						'directory',
						'symbolic-link',
						'socket',
						'block-device',
						'character-device',
						'fifo',
						'file'
					)),
					size INTEGER NOT NULL,
					modified_ms INTEGER NOT NULL,
					hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
					UNIQUE(root_id, relative_path)
				);

				INSERT INTO entries_v2(id, root_id, relative_path, name, type, size, modified_ms, hidden)
				SELECT id, root_id, relative_path, name, type, size, modified_ms, hidden
				FROM entries;

				DROP TABLE entries;
				ALTER TABLE entries_v2 RENAME TO entries;

				CREATE INDEX entries_by_name ON entries(root_id, name);
				CREATE INDEX entries_by_root_visibility ON entries(root_id, hidden, id);
			`)
		},
	},
	{
		version: 3,
		up: (database) => {
			database.exec(`
				DROP INDEX entries_by_name;

				CREATE VIRTUAL TABLE entry_names_fts USING fts5(
					name,
					content = 'entries',
					content_rowid = 'id',
					tokenize = 'trigram',
					detail = 'none'
				);
				CREATE TRIGGER entries_fts_insert AFTER INSERT ON entries BEGIN
					INSERT INTO entry_names_fts(rowid, name) VALUES (new.id, new.name);
				END;

				CREATE TRIGGER entries_fts_delete AFTER DELETE ON entries BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, name)
					VALUES ('delete', old.id, old.name);
				END;

				CREATE TRIGGER entries_fts_update AFTER UPDATE OF name ON entries
				WHEN old.name IS NOT new.name BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, name)
					VALUES ('delete', old.id, old.name);
					INSERT INTO entry_names_fts(rowid, name) VALUES (new.id, new.name);
				END;

				INSERT INTO entry_names_fts(entry_names_fts) VALUES ('rebuild');
			`)
		},
	},
	{
		version: 4,
		up: (database) => {
			database.exec("CREATE VIRTUAL TABLE entry_names_fts_vocab USING fts5vocab(entry_names_fts, 'row')")
		},
	},
	{
		version: 5,
		up: (database) => {
			database.function('normalize_nfc', {deterministic: true}, (value: unknown) => {
				if (typeof value !== 'string') throw new TypeError('normalize_nfc expects text')
				return value.normalize('NFC')
			})
			database.exec(`
				DROP TABLE entry_names_fts_vocab;
				DROP TRIGGER entries_fts_insert;
				DROP TRIGGER entries_fts_delete;
				DROP TRIGGER entries_fts_update;
				DROP TABLE entry_names_fts;

				ALTER TABLE entries ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
				UPDATE entries SET search_name = normalize_nfc(name);
				CREATE INDEX entries_by_search_name ON entries(root_id, search_name COLLATE NOCASE);

				CREATE VIRTUAL TABLE entry_names_fts USING fts5(
					search_name,
					content = 'entries',
					content_rowid = 'id',
					tokenize = 'trigram',
					detail = 'none'
				);
				CREATE TRIGGER entries_fts_insert AFTER INSERT ON entries BEGIN
					INSERT INTO entry_names_fts(rowid, search_name) VALUES (new.id, new.search_name);
				END;

				CREATE TRIGGER entries_fts_delete AFTER DELETE ON entries BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, search_name)
					VALUES ('delete', old.id, old.search_name);
				END;

				CREATE TRIGGER entries_fts_update AFTER UPDATE OF search_name ON entries
				WHEN old.search_name IS NOT new.search_name BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, search_name)
					VALUES ('delete', old.id, old.search_name);
					INSERT INTO entry_names_fts(rowid, search_name) VALUES (new.id, new.search_name);
				END;

				INSERT INTO entry_names_fts(entry_names_fts) VALUES ('rebuild');
				CREATE VIRTUAL TABLE entry_names_fts_vocab USING fts5vocab(entry_names_fts, 'row');
			`)
		},
	},
	{
		version: 6,
		up: (database) => {
			database.function('fold_search_name', {deterministic: true}, (value: unknown) => {
				if (typeof value !== 'string') throw new TypeError('fold_search_name expects text')
				return foldSearchName(value)
			})
			database.exec(`
				DROP INDEX entries_by_search_name;
				ALTER TABLE entries ADD COLUMN search_name_folded TEXT NOT NULL DEFAULT '';
				UPDATE entries SET search_name_folded = fold_search_name(name);
				CREATE INDEX entries_by_folded_search_name ON entries(root_id, search_name_folded);
			`)
		},
	},
]

export const FILE_INDEX_SCHEMA_VERSION = fileIndexMigrations.at(-1)?.version ?? 0

export async function migrateFileIndex(
	database: BetterSqlite3.Database,
	migrations: FileIndexMigration[] = fileIndexMigrations,
): Promise<number> {
	database.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`)

	const appliedRows = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
		version: number
	}>
	const applied = new Set(appliedRows.map(({version}) => Number(version)))

	for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
		if (applied.has(migration.version)) continue

		const runMigration = database.transaction(() => {
			migration.up(database)
			database
				.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
				.run(migration.version, Date.now())
		})
		runMigration.immediate()
	}

	const row = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
		version: number
	}
	return Number(row.version)
}
