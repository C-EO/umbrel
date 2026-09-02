import {randomUUID} from 'node:crypto'
import nodePath from 'node:path'

import type DatabaseTypes from 'better-sqlite3'

import {filenameStemSql, foldSearchName} from '../files/file-index/migrations.js'
import type {
	PhotoAlbum,
	PhotoFilter,
	PhotoIndexingState,
	PhotoItem,
	PhotoItemDetail,
	PhotoScopeMode,
	PhotoSource,
} from './types.js'
import {PHOTO_EXTENSIONS, supportsPhotos, VIDEO_EXTENSIONS} from './types.js'

type Database = DatabaseTypes.Database

type IndexedPhotoEntry = {
	rootId: number
	relativePath: string
	name: string
	type: string
	hidden: number
}

type ItemRow = {
	id: string
	kind: 'photo' | 'video'
	sub_kind: 'live' | 'panorama' | 'screenshot' | 'spherical' | null
	taken_at: number
	taken_at_offset_minutes: number | null
	width: number
	height: number
	duration_ms: number | null
	is_favorite: number
	tint: number | null
}

type ItemDetailRow = ItemRow & {
	file_name: string
	size_bytes: number
	source_id: string
	source_name: string
	source_type: 'umbrel' | 'iphone'
	root_virtual_path: string
	relative_path: string
	created_at: number
	imported_at: number
	camera_make: string | null
	camera_model: string | null
	lens: string | null
	focal_length: string | null
	aperture: string | null
	exposure: string | null
	iso: number | null
	latitude: number | null
	longitude: number | null
	altitude: number | null
	user_comment: string | null
}

type Query = {sql: string; parameters: unknown[]}
type PhotoRootKind = 'home' | 'trash'
type PhotoContentReference = {accountId: string; hash: Buffer}
type PhotoContentRefresh = {accountId: string; hashes?: Buffer[]}

const HASH_PATTERN = /^[a-f0-9]{64}$/
const UNKNOWN_EFFECTIVE_TAKEN_AT = -8_640_000_000_000_000
const TARGETED_HASH_BATCH_SIZE = 128
const ACCOUNT_WIDE_REFRESH_THRESHOLD = 32_768
const PHOTO_MEDIA_EXTENSIONS = [...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS]
const LIVE_FALLBACK_STEM_SQL = filenameStemSql('entries.name', PHOTO_MEDIA_EXTENSIONS)

function targetedPhotoContentCtes(hashCount: number) {
	const fallbackEntryStem = filenameStemSql('fallback_entry.name', PHOTO_MEDIA_EXTENSIONS)
	const fallbackEntryParent =
		'substr(fallback_entry.relative_path, 1, length(fallback_entry.relative_path) - length(fallback_entry.name))'
	const requestedValues = Array.from({length: hashCount}, () => '(?)').join(', ')
	return `WITH RECURSIVE requested_values(content_hash) AS (VALUES ${requestedValues}),
	requested_hashes(content_hash) AS MATERIALIZED (
		SELECT DISTINCT content_hash FROM requested_values WHERE content_hash IS NOT NULL
	),
	requested_account(account_id) AS (VALUES (?)),
	related_content_ids(content_id) AS (
		SELECT contents.id
		FROM requested_hashes
		CROSS JOIN contents INDEXED BY sqlite_autoindex_contents_1
			ON contents.blake3 = requested_hashes.content_hash

		-- Apple identifiers connect every still and competing motion that can
		-- change exact-pair selection or visibility for the current component.
		UNION
		SELECT peer_metadata.content_id
		FROM related_content_ids AS related
		CROSS JOIN media_metadata AS related_metadata ON related_metadata.content_id = related.content_id
		CROSS JOIN media_metadata AS peer_metadata INDEXED BY media_metadata_by_live_identifier
			ON peer_metadata.live_identifier = related_metadata.live_identifier
		WHERE related_metadata.state = 'ready' AND related_metadata.live_identifier IS NOT NULL
			AND peer_metadata.state = 'ready'
			AND EXISTS (
				SELECT 1 FROM entries AS account_entry
				JOIN index_roots AS account_root ON account_root.id = account_entry.root_id
				WHERE account_entry.content_id = peer_metadata.content_id
					AND account_root.owner_id = (SELECT account_id FROM requested_account)
					AND account_root.kind IN ('home', 'trash')
					AND account_entry.type = 'file' AND account_entry.hidden = 0
			)

		-- The same-folder/stem fallback can overlap exact-ID groups. Recursing
		-- until convergence is necessary: a newly selected exact pair can expose
		-- a fallback motion, which can in turn change another exact group.
		UNION
		SELECT fallback_entry.content_id
		FROM related_content_ids AS related
		CROSS JOIN entries AS related_entry INDEXED BY entries_by_content
			ON related_entry.content_id = related.content_id
		JOIN index_roots ON index_roots.id = related_entry.root_id
		JOIN media_metadata AS related_metadata ON related_metadata.content_id = related.content_id
			AND related_metadata.state = 'ready'
		CROSS JOIN entries AS fallback_entry INDEXED BY entries_by_photos_live_fallback
			ON fallback_entry.root_id = related_entry.root_id
			AND ${fallbackEntryParent} =
				substr(related_entry.relative_path, 1, length(related_entry.relative_path) - length(related_entry.name))
			AND ${fallbackEntryStem} = ${filenameStemSql('related_entry.name', PHOTO_MEDIA_EXTENSIONS)}
		JOIN media_metadata AS fallback_metadata ON fallback_metadata.content_id = fallback_entry.content_id
			AND fallback_metadata.state = 'ready'
		WHERE index_roots.owner_id = (SELECT account_id FROM requested_account)
			AND index_roots.kind IN ('home', 'trash')
			AND related_entry.type = 'file' AND related_entry.hidden = 0
			AND fallback_entry.type = 'file' AND fallback_entry.hidden = 0
			AND fallback_entry.thumbnail_identity_kind = 'content'
			AND ((related_metadata.kind = 'photo' AND fallback_metadata.kind = 'video'
					AND fallback_metadata.duration_ms <= 10000)
				OR (related_metadata.kind = 'video' AND related_metadata.duration_ms <= 10000
					AND fallback_metadata.kind = 'photo'))
	),
	relevant_contents(content_hash) AS MATERIALIZED (
		SELECT content_hash FROM requested_hashes
		UNION
		SELECT contents.blake3 FROM related_content_ids
		CROSS JOIN contents ON contents.id = related_content_ids.content_id
	),`
}

function photoLibraryCte(targetHashCount = 0) {
	const targeted = targetHashCount > 0
	const ctePrefix = targeted ? targetedPhotoContentCtes(targetHashCount) : 'WITH'
	const accountSql = targeted ? '(SELECT account_id FROM requested_account)' : '?'
	const indexedFromSql = targeted
		? `FROM relevant_contents
		CROSS JOIN contents INDEXED BY sqlite_autoindex_contents_1
			ON contents.blake3 = relevant_contents.content_hash
		CROSS JOIN entries INDEXED BY entries_by_content ON entries.content_id = contents.id
		JOIN index_roots ON index_roots.id = entries.root_id`
		: `FROM index_roots
		JOIN entries ON entries.root_id = index_roots.id
		JOIN contents ON contents.id = entries.content_id`
	return `
	${ctePrefix} indexed_locations AS ${targeted ? 'MATERIALIZED' : ''} (
		SELECT index_roots.owner_id AS account_id,
			index_roots.kind AS root_kind,
			contents.blake3 AS content_hash, lower(hex(contents.blake3)) AS id,
			contents.created_at AS content_created_at,
			entries.id AS entry_id, entries.content_id, entries.name, entries.search_name_folded,
			entries.size, entries.modified_ms, entries.birthtime_ms, entries.relative_path,
			index_roots.virtual_path AS root_virtual_path,
			media_metadata.kind, media_metadata.sub_kind, media_metadata.live_identifier, media_metadata.taken_at,
			media_metadata.taken_at_offset_minutes, media_metadata.created_at,
			media_metadata.width, media_metadata.height, media_metadata.duration_ms, media_metadata.tint,
			media_metadata.camera_make, media_metadata.camera_model, media_metadata.lens,
			media_metadata.focal_length, media_metadata.aperture, media_metadata.exposure,
			media_metadata.iso, media_metadata.latitude, media_metadata.longitude,
			media_metadata.altitude, media_metadata.user_comment, media_metadata.search_text,
			substr(entries.relative_path, 1, length(entries.relative_path) - length(entries.name))
				AS live_fallback_parent,
			${LIVE_FALLBACK_STEM_SQL} AS live_fallback_stem
		${indexedFromSql}
		JOIN media_metadata ON media_metadata.content_id = entries.content_id AND media_metadata.state = 'ready'
		WHERE index_roots.owner_id = ${accountSql} AND index_roots.kind IN ('home', 'trash')
			AND entries.type = 'file' AND entries.hidden = 0
	),
	authorized_locations AS (
		SELECT DISTINCT indexed_locations.*, iphone_source.id AS source_id,
			iphone_source.name AS source_name, iphone_source.type AS source_type
		FROM indexed_locations
		JOIN umbrel.photos_source_resources AS resource
			ON resource.account_id = indexed_locations.account_id
			AND resource.content_hash = indexed_locations.content_hash
		JOIN umbrel.photos_sources AS iphone_source ON iphone_source.id = resource.source_id
			AND iphone_source.account_id = resource.account_id AND iphone_source.type = 'iphone'
		UNION ALL
		SELECT indexed_locations.*, umbrel_source.id AS source_id,
			umbrel_source.name AS source_name, umbrel_source.type AS source_type
		FROM indexed_locations
		JOIN umbrel.photos_sources AS umbrel_source ON umbrel_source.account_id = indexed_locations.account_id
			AND umbrel_source.type = 'umbrel'
		WHERE (indexed_locations.root_kind = 'trash' OR
			${sourceScopeSql('umbrel_source', 'indexed_locations', 'indexed_locations', 'root_virtual_path')})
			AND NOT EXISTS (
				SELECT 1 FROM umbrel.photos_source_resources AS resource
				JOIN umbrel.photos_sources AS iphone_source ON iphone_source.id = resource.source_id
					AND iphone_source.account_id = resource.account_id AND iphone_source.type = 'iphone'
				WHERE resource.account_id = indexed_locations.account_id
					AND resource.content_hash = indexed_locations.content_hash
			)
	),
	ranked_locations AS (
		SELECT *, ROW_NUMBER() OVER (
			PARTITION BY content_hash, root_kind
			ORDER BY source_type = 'umbrel', source_id, root_virtual_path, relative_path
		) AS location_rank
		FROM authorized_locations
	),
	canonical_locations AS (
		SELECT * FROM ranked_locations WHERE location_rank = 1
	),
	ranked_exact_live_motions AS (
		SELECT account_id, live_identifier, content_hash, root_virtual_path, relative_path,
			ROW_NUMBER() OVER (
				PARTITION BY account_id, live_identifier
				ORDER BY root_virtual_path, relative_path, content_hash
			) AS motion_rank
		FROM authorized_locations
		WHERE kind = 'video' AND live_identifier IS NOT NULL
	),
	exact_live_motions AS (
		SELECT account_id, live_identifier, content_hash, root_virtual_path, relative_path
		FROM ranked_exact_live_motions WHERE motion_rank = 1
	),
	ranked_fallback_live_motions AS (
		SELECT account_id, root_virtual_path, live_fallback_parent, live_fallback_stem,
			content_hash, relative_path,
			ROW_NUMBER() OVER (
				PARTITION BY account_id, root_virtual_path, live_fallback_parent, live_fallback_stem
				ORDER BY relative_path, content_hash
			) AS motion_rank
		FROM authorized_locations
		WHERE kind = 'video' AND duration_ms <= 10000
	),
	fallback_live_motions AS (
		SELECT account_id, root_virtual_path, live_fallback_parent, live_fallback_stem,
			content_hash, relative_path
		FROM ranked_fallback_live_motions WHERE motion_rank = 1
	),
	live_pair_candidates AS (
		SELECT still.account_id, still.content_hash AS still_hash,
			motion.content_hash AS motion_hash, motion.root_virtual_path AS motion_root_virtual_path,
			motion.relative_path AS motion_relative_path, 0 AS match_rank
		FROM authorized_locations AS still
		JOIN exact_live_motions AS motion ON motion.account_id = still.account_id
			AND motion.live_identifier = still.live_identifier
		WHERE still.kind = 'photo' AND still.live_identifier IS NOT NULL

		UNION ALL

		SELECT still.account_id, still.content_hash AS still_hash,
			motion.content_hash AS motion_hash, motion.root_virtual_path AS motion_root_virtual_path,
			motion.relative_path AS motion_relative_path, 1 AS match_rank
		FROM authorized_locations AS still
		JOIN fallback_live_motions AS motion ON motion.account_id = still.account_id
			AND motion.root_virtual_path = still.root_virtual_path
			AND motion.live_fallback_parent = still.live_fallback_parent
			AND motion.live_fallback_stem = still.live_fallback_stem
		WHERE still.kind = 'photo'
	),
	ranked_live_pairs AS (
		SELECT *, ROW_NUMBER() OVER (
			PARTITION BY account_id, still_hash
			ORDER BY match_rank, motion_root_virtual_path, motion_relative_path, motion_hash
		) AS pair_rank
		FROM live_pair_candidates
	),
	derived_live_pairs AS (
		SELECT account_id, still_hash, motion_hash
		FROM ranked_live_pairs WHERE pair_rank = 1
	),
	active_live_pairs AS (
		SELECT pair.account_id, pair.still_hash, pair.motion_hash, location_kind.root_kind
		FROM derived_live_pairs AS pair
		CROSS JOIN (SELECT 'home' AS root_kind UNION ALL SELECT 'trash') AS location_kind
		WHERE EXISTS (
			SELECT 1 FROM authorized_locations AS still
			WHERE still.account_id = pair.account_id AND still.content_hash = pair.still_hash
				AND still.root_kind = location_kind.root_kind
		) AND EXISTS (
			SELECT 1 FROM authorized_locations AS motion
			WHERE motion.account_id = pair.account_id AND motion.content_hash = pair.motion_hash
				AND motion.root_kind = location_kind.root_kind
		)
	),
	logical_items AS (
		SELECT canonical_locations.*,
			COALESCE(umbrel.photos_content_state.is_favorite, 0) AS is_favorite,
			COALESCE(umbrel.photos_content_state.imported_at, canonical_locations.content_created_at) AS imported_at,
			COALESCE(canonical_locations.taken_at, umbrel.photos_content_state.source_created_at,
				canonical_locations.birthtime_ms,
				canonical_locations.modified_ms) AS logical_taken_at,
			COALESCE(canonical_locations.created_at, umbrel.photos_content_state.source_created_at,
				canonical_locations.birthtime_ms,
				canonical_locations.modified_ms) AS logical_created_at,
			CASE
				WHEN canonical_locations.sub_kind = 'spherical' THEN 'spherical'
				WHEN live_pair.still_hash IS NOT NULL OR canonical_locations.sub_kind = 'live' THEN 'live'
				WHEN lower(canonical_locations.name) LIKE 'screenshot%'
					OR lower(canonical_locations.name) LIKE 'screen shot%'
					OR lower(canonical_locations.user_comment) LIKE '%screenshot%'
					OR lower(canonical_locations.user_comment) LIKE '%screen shot%'
					OR (lower(canonical_locations.name) GLOB '*.png'
						AND canonical_locations.camera_make IS NULL AND canonical_locations.camera_model IS NULL)
				THEN 'screenshot'
				WHEN canonical_locations.sub_kind IS NOT NULL THEN canonical_locations.sub_kind
				ELSE NULL
			END AS logical_sub_kind
		FROM canonical_locations
		LEFT JOIN umbrel.photos_content_state ON umbrel.photos_content_state.account_id = canonical_locations.account_id
			AND umbrel.photos_content_state.content_hash = canonical_locations.content_hash
		LEFT JOIN active_live_pairs AS live_pair ON live_pair.account_id = canonical_locations.account_id
			AND live_pair.still_hash = canonical_locations.content_hash
			AND live_pair.root_kind = canonical_locations.root_kind
		WHERE NOT EXISTS (
			SELECT 1 FROM active_live_pairs AS hidden_motion
			WHERE hidden_motion.account_id = canonical_locations.account_id
				AND hidden_motion.motion_hash = canonical_locations.content_hash
				AND hidden_motion.root_kind = canonical_locations.root_kind
		)
	)`
}

const PHOTO_LIBRARY_CTE = photoLibraryCte()

const ITEM_SELECT = `
	SELECT id, kind, logical_sub_kind AS sub_kind, logical_taken_at AS taken_at,
		taken_at_offset_minutes, width, height, duration_ms, is_favorite, tint`

export default class PhotosRepository {
	#preparedStatements = new WeakMap<Database, Map<string, DatabaseTypes.Statement>>()

	syncEntry(database: Database, entry: IndexedPhotoEntry) {
		const root = database.prepare('SELECT owner_id, kind FROM index_roots WHERE id = ?').get(entry.rootId) as
			| {owner_id: string; kind: string}
			| undefined
		if (!root || !isPhotoRootKind(root.kind)) return false
		this.#ensureSource(database, root.owner_id)
		if (entry.type !== 'file' || entry.hidden || !supportsPhotos(entry.name)) return true
		const content = database
			.prepare(
				`SELECT contents.blake3 FROM entries
				JOIN contents ON contents.id = entries.content_id
				WHERE entries.root_id = ? AND entries.relative_path = ?`,
			)
			.get(entry.rootId, entry.relativePath) as {blake3: Buffer} | undefined
		if (content) {
			this.#ensureContentState(database, root.owner_id, content.blake3)
			this.#refreshEffectiveTakenAt(database, root.owner_id, [content.blake3])
		}
		return true
	}

	detachPath(database: Database, rootId: number, relativePath: string) {
		if (relativePath === '') {
			const references = this.#pathContentReferences(database, rootId, '1', [])
			return this.#invalidateEffectiveTakenAt(database, references)
		}
		const prefix = `${relativePath}/`
		const prefixEnd = `${relativePath}0`
		const references = this.#pathContentReferences(
			database,
			rootId,
			`entries.relative_path = ? OR (entries.relative_path >= ? AND entries.relative_path < ?)`,
			[relativePath, prefix, prefixEnd],
		)
		return this.#invalidateEffectiveTakenAt(database, references)
	}

	detachUnseen(database: Database, rootId: number) {
		const references = this.#pathContentReferences(
			database,
			rootId,
			`NOT EXISTS (
				SELECT 1 FROM reconciliation_seen
				WHERE reconciliation_seen.root_id = entries.root_id
					AND reconciliation_seen.relative_path = entries.relative_path
			)`,
			[],
		)
		return this.#invalidateEffectiveTakenAt(database, references)
	}

	detachEntry(database: Database, rootId: number, relativePath: string) {
		const references = this.#pathContentReferences(database, rootId, 'entries.relative_path = ?', [relativePath])
		return this.#invalidateEffectiveTakenAt(database, references)
	}

	refreshEffectiveTakenAt(database: Database, refreshes: PhotoContentRefresh[]) {
		for (const {accountId, hashes} of refreshes) {
			this.#refreshEffectiveTakenAt(database, accountId, hashes)
		}
	}

	syncAll(database: Database, accountId?: string) {
		const projectionRecovery = !this.#projectionGenerationMatches(database)
		const accounts = database
			.prepare(
				`SELECT DISTINCT owner_id FROM index_roots
				WHERE kind IN ('home', 'trash') ${accountId && !projectionRecovery ? 'AND owner_id = ?' : ''}`,
			)
			.all(...(accountId && !projectionRecovery ? [accountId] : [])) as Array<{owner_id: string}>
		let changed = projectionRecovery
		for (const {owner_id: ownerId} of accounts) {
			const sourceId = this.#ensureSource(database, ownerId)
			const hasReadyHomeMedia = Boolean(
				database
					.prepare(
						`SELECT 1 FROM index_roots
						JOIN entries ON entries.root_id = index_roots.id
						JOIN media_metadata ON media_metadata.content_id = entries.content_id
							AND media_metadata.state = 'ready'
						WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
							AND entries.type = 'file' AND entries.hidden = 0 LIMIT 1`,
					)
					.get(ownerId),
			)
			if (!hasReadyHomeMedia) {
				// A rebuilt disposable index must not inherit visible timeline rows
				// from durable state before its replacement metadata is ready.
				database
					.prepare(
						`UPDATE umbrel.photos_content_state SET effective_taken_at = NULL
						WHERE account_id = ? AND effective_taken_at IS NOT NULL
							AND effective_taken_at <> ?`,
					)
					.run(ownerId, UNKNOWN_EFFECTIVE_TAKEN_AT)
			}
			const requiresBackfill = Boolean(
				database
					.prepare(
						`SELECT 1 FROM umbrel.photos_content_state
						WHERE account_id = ? AND effective_taken_at = ? LIMIT 1`,
					)
					.get(ownerId, UNKNOWN_EFFECTIVE_TAKEN_AT),
			)
			const inserted = database
				.prepare(
					`INSERT INTO umbrel.photos_content_state(
						account_id, content_hash, source_id, is_favorite, imported_at
					)
					SELECT ?, contents.blake3, ?, 0, MIN(contents.created_at)
					FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN contents ON contents.id = entries.content_id
					JOIN media_metadata ON media_metadata.content_id = contents.id
					WHERE index_roots.owner_id = ? AND index_roots.kind IN ('home', 'trash')
						AND entries.type = 'file' AND entries.hidden = 0
					GROUP BY contents.blake3
					ON CONFLICT(account_id, content_hash) DO NOTHING
					RETURNING content_hash`,
				)
				.all(ownerId, sourceId, ownerId) as Array<{content_hash: Buffer}>
			changed = inserted.length > 0 || changed
			if (projectionRecovery || requiresBackfill || inserted.length > TARGETED_HASH_BATCH_SIZE) {
				this.#refreshEffectiveTakenAt(database, ownerId, undefined, false)
			} else if (inserted.length > 0) {
				this.#refreshEffectiveTakenAt(
					database,
					ownerId,
					inserted.map(({content_hash}) => content_hash),
					false,
				)
			}
		}
		this.#synchronizeProjectionGeneration(database)
		return changed
	}

	upsertBackupSource(database: Database, accountId: string, sourceId: string, name: string, createdAt: number) {
		const existing = database
			.prepare('SELECT account_id, type FROM umbrel.photos_sources WHERE id = ?')
			.get(sourceId) as {account_id: string; type: string} | undefined
		if (existing && (existing.account_id !== accountId || existing.type !== 'iphone')) {
			throw new Error('Photo backup source identity collision')
		}
		database
			.prepare(
				`INSERT INTO umbrel.photos_sources(id, account_id, type, name, created_at)
				VALUES (?, ?, 'iphone', ?, ?)
				ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
			)
			.run(sourceId, accountId, name, createdAt)
		return true
	}

	registerBackupResource(
		database: Database,
		accountId: string,
		sourceId: string,
		resourceKey: string,
		entryId: number,
		hash: Buffer,
		originalFilename?: string,
		sourceCreationDate?: number,
	) {
		const source = database
			.prepare("SELECT 1 FROM umbrel.photos_sources WHERE id = ? AND account_id = ? AND type = 'iphone'")
			.get(sourceId, accountId)
		if (!source) throw new Error('Photo backup source was not registered')
		const uploaded = database
			.prepare(
				`SELECT contents.blake3, entries.content_id, entries.size, entries.relative_path, index_roots.virtual_path
				FROM entries
				JOIN index_roots ON index_roots.id = entries.root_id
				LEFT JOIN contents ON contents.id = entries.content_id
				WHERE entries.id = ? AND index_roots.owner_id = ? AND index_roots.kind = 'home'
					AND entries.type = 'file' AND entries.hidden = 0`,
			)
			.get(entryId, accountId) as
			| {blake3: Buffer | null; content_id: number | null; size: number; relative_path: string; virtual_path: string}
			| undefined
		if (!uploaded) throw new Error('Uploaded Photos backup resource was not indexed')
		if (uploaded.blake3 && !uploaded.blake3.equals(hash)) throw new Error('Uploaded Photos backup hash mismatch')
		const now = Date.now()
		database
			.prepare(
				`INSERT INTO umbrel.photos_source_resources(
					account_id, source_id, resource_key, content_hash, original_filename
				)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(account_id, source_id, resource_key)
				DO UPDATE SET
					content_hash = excluded.content_hash,
					original_filename = COALESCE(photos_source_resources.original_filename, excluded.original_filename)`,
			)
			.run(accountId, sourceId, resourceKey, hash, originalFilename ?? null)
		if (uploaded.content_id !== null) {
			database
				.prepare(
					`INSERT INTO umbrel.photos_content_state(
						account_id, content_hash, source_id, is_favorite, imported_at, source_created_at
					)
					VALUES (?, ?, ?, 0, ?, ?)
					ON CONFLICT(account_id, content_hash) DO UPDATE SET
						source_id = CASE
							WHEN (SELECT type FROM umbrel.photos_sources WHERE id = photos_content_state.source_id) = 'umbrel'
							THEN excluded.source_id ELSE photos_content_state.source_id END,
						source_created_at = COALESCE(photos_content_state.source_created_at, excluded.source_created_at)`,
				)
				.run(accountId, hash, sourceId, now, sourceCreationDate ?? null)
			this.#refreshEffectiveTakenAt(database, accountId, [hash])
		}
		database.prepare('UPDATE umbrel.photos_sources SET last_import_at = ? WHERE id = ?').run(now, sourceId)
		return {
			resourceKey,
			path: nodePath.posix.join(uploaded.virtual_path, uploaded.relative_path),
			bytes: Number(uploaded.size),
		}
	}

	confirmedBackupResources(database: Database, accountId: string, sourceId: string, resourceKeys: string[]) {
		if (resourceKeys.length === 0) return []
		const placeholders = resourceKeys.map(() => '?').join(', ')
		return (
			database
				.prepare(
					`WITH candidates AS (
						SELECT resource.resource_key, entries.device, entries.inode, entries.size,
							entries.modified_ns, entries.ctime_ns, entries.relative_path, index_roots.virtual_path,
							ROW_NUMBER() OVER (
								PARTITION BY resource.resource_key
								ORDER BY index_roots.virtual_path, entries.relative_path
							) AS location_rank
						FROM umbrel.photos_source_resources AS resource
						JOIN contents ON contents.blake3 = resource.content_hash
						JOIN entries ON entries.content_id = contents.id
						JOIN index_roots ON index_roots.id = entries.root_id
						WHERE resource.account_id = ? AND resource.source_id = ?
							AND resource.resource_key IN (${placeholders})
							AND index_roots.owner_id = resource.account_id AND index_roots.kind = 'home'
							AND entries.type = 'file' AND entries.hidden = 0
					) SELECT resource.resource_key, resource.content_hash,
						candidates.device, candidates.inode, candidates.size,
						candidates.modified_ns, candidates.ctime_ns,
						candidates.relative_path, candidates.virtual_path
					FROM umbrel.photos_source_resources AS resource
					LEFT JOIN candidates ON candidates.resource_key = resource.resource_key
						AND candidates.location_rank = 1
					WHERE resource.account_id = ? AND resource.source_id = ?
						AND resource.resource_key IN (${placeholders})
					ORDER BY resource.resource_key`,
				)
				.all(accountId, sourceId, ...resourceKeys, accountId, sourceId, ...resourceKeys) as Array<{
				resource_key: string
				content_hash: Buffer
				device: string | null
				inode: string | null
				size: number | null
				modified_ns: string | null
				ctime_ns: string | null
				relative_path: string | null
				virtual_path: string | null
			}>
		).map((row) => ({
			resourceKey: row.resource_key,
			contentHash: row.content_hash,
			...(row.virtual_path === null ||
			row.relative_path === null ||
			row.device === null ||
			row.inode === null ||
			row.size === null ||
			row.modified_ns === null ||
			row.ctime_ns === null
				? {}
				: {
						path: nodePath.posix.join(row.virtual_path, row.relative_path),
						bytes: Number(row.size),
						revision: {
							device: row.device,
							inode: row.inode,
							size: Number(row.size),
							modifiedNs: row.modified_ns,
							ctimeNs: row.ctime_ns,
						},
					}),
		}))
	}

	unresolvedBackupResourceHashes(database: Database, accountId: string, sourceId: string) {
		return (
			database
				.prepare(
					`SELECT DISTINCT resource.content_hash
					FROM umbrel.photos_source_resources AS resource
					WHERE resource.account_id = ? AND resource.source_id = ?
						AND NOT EXISTS (
							SELECT 1 FROM contents
							JOIN entries ON entries.content_id = contents.id
							JOIN index_roots ON index_roots.id = entries.root_id
							WHERE contents.blake3 = resource.content_hash
								AND index_roots.owner_id = resource.account_id AND index_roots.kind = 'home'
								AND entries.type = 'file' AND entries.hidden = 0
						)`,
				)
				.all(accountId, sourceId) as Array<{content_hash: Buffer}>
		).map(({content_hash}) => content_hash)
	}

	sourceRemovalFiles(database: Database, accountId: string, sourceId: string) {
		return (
			database
				.prepare(
					`WITH exclusive_resources AS (
						SELECT DISTINCT resource.content_hash
						FROM umbrel.photos_source_resources AS resource
						WHERE resource.account_id = ? AND resource.source_id = ?
							AND NOT EXISTS (
								SELECT 1 FROM umbrel.photos_source_resources AS other
								WHERE other.account_id = resource.account_id
									AND other.content_hash = resource.content_hash
									AND other.source_id <> resource.source_id
							)
							AND 1 = (
								SELECT COUNT(*) FROM contents
								JOIN entries ON entries.content_id = contents.id
								JOIN index_roots ON index_roots.id = entries.root_id
								WHERE contents.blake3 = resource.content_hash
									AND index_roots.owner_id = resource.account_id
									AND index_roots.kind = 'home'
									AND entries.type = 'file' AND entries.hidden = 0
							)
					)
					SELECT lower(hex(contents.blake3)) AS id, index_roots.virtual_path,
						entries.relative_path, entries.inode, entries.size,
						entries.modified_ns, entries.ctime_ns
					FROM exclusive_resources
					JOIN contents ON contents.blake3 = exclusive_resources.content_hash
					JOIN entries ON entries.content_id = contents.id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
						AND entries.type = 'file' AND entries.hidden = 0
					ORDER BY index_roots.virtual_path, entries.relative_path`,
				)
				.all(accountId, sourceId, accountId) as Array<{
				id: string
				virtual_path: string
				relative_path: string
				inode: string
				size: number
				modified_ns: string
				ctime_ns: string
			}>
		).map((row) => ({
			id: row.id,
			path: joinVirtualPath(row.virtual_path, row.relative_path),
			revision: {
				inode: row.inode,
				size: Number(row.size),
				modifiedNs: row.modified_ns,
				ctimeNs: row.ctime_ns,
			},
		}))
	}

	attachContentHash(database: Database, entryId: number, hash: Buffer) {
		const root = database
			.prepare(
				`SELECT index_roots.owner_id, index_roots.kind FROM entries
				JOIN index_roots ON index_roots.id = entries.root_id
				WHERE entries.id = ?`,
			)
			.get(entryId) as {owner_id: string; kind: string} | undefined
		if (!root || !isPhotoRootKind(root.kind)) return false
		const changed = this.#ensureContentState(database, root.owner_id, hash)
		this.#refreshEffectiveTakenAt(database, root.owner_id, [hash])
		return changed
	}

	refreshContentEffectiveTakenAt(database: Database, contentId: number) {
		const content = database.prepare('SELECT blake3 FROM contents WHERE id = ?').get(contentId) as
			| {blake3: Buffer}
			| undefined
		if (!content) return []
		const accountIds = this.accountIdsForContent(database, contentId)
		for (const accountId of accountIds) this.#refreshEffectiveTakenAt(database, accountId, [content.blake3])
		return accountIds
	}

	accountIdsForContent(database: Database, contentId: number) {
		return (
			database
				.prepare(
					`SELECT DISTINCT index_roots.owner_id FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.content_id = ? AND index_roots.kind IN ('home', 'trash')`,
				)
				.all(contentId) as Array<{owner_id: string}>
		).map(({owner_id}) => owner_id)
	}

	accountIdsForEntry(database: Database, entryId: number) {
		return (
			database
				.prepare(
					`SELECT DISTINCT index_roots.owner_id FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.id = ? AND index_roots.kind IN ('home', 'trash')`,
				)
				.all(entryId) as Array<{owner_id: string}>
		).map(({owner_id}) => owner_id)
	}

	registerUpload(database: Database, accountId: string, entryId: number, albumId?: string) {
		if (albumId && !this.#albumExists(database, accountId, albumId)) throw new Error('[photos-album-not-found]')
		const uploaded = database
			.prepare(
				`SELECT contents.blake3 FROM entries
				JOIN index_roots ON index_roots.id = entries.root_id
				JOIN contents ON contents.id = entries.content_id
				WHERE entries.id = ? AND index_roots.owner_id = ? AND index_roots.kind = 'home'
					AND entries.type = 'file' AND entries.hidden = 0`,
			)
			.get(entryId, accountId) as {blake3: Buffer} | undefined
		if (!uploaded) throw new Error('Uploaded Photos item was not indexed')
		if (this.#ensureContentState(database, accountId, uploaded.blake3)) {
			this.#refreshEffectiveTakenAt(database, accountId, [uploaded.blake3])
		}
		if (albumId) this.#addAlbumHash(database, accountId, albumId, uploaded.blake3)
		const id = hashToId(uploaded.blake3)
		return {status: 'imported' as const, itemId: id, uploadedItemId: id}
	}

	prepareUpload(database: Database, accountId: string, hash: Buffer, albumId?: string) {
		if (albumId && !this.#albumExists(database, accountId, albumId)) throw new Error('[photos-album-not-found]')
		this.#ensureSource(database, accountId)
		const duplicate = database
			.prepare(
				`SELECT 1 FROM index_roots
				JOIN entries ON entries.root_id = index_roots.id
				JOIN contents ON contents.id = entries.content_id
				JOIN umbrel.photos_sources AS photos_source ON photos_source.account_id = index_roots.owner_id
					AND photos_source.type = 'umbrel'
				LEFT JOIN umbrel.photos_content_state ON umbrel.photos_content_state.account_id = index_roots.owner_id
					AND umbrel.photos_content_state.content_hash = contents.blake3
				WHERE index_roots.owner_id = ? AND index_roots.kind = 'home' AND contents.blake3 = ?
					AND entries.type = 'file' AND entries.hidden = 0
					AND ${sourceScopeSql('photos_source')}
				LIMIT 1`,
			)
			.get(accountId, hash)
		if (!duplicate) return {status: 'new' as const}
		if (this.#ensureContentState(database, accountId, hash)) {
			this.#refreshEffectiveTakenAt(database, accountId, [hash])
		}
		if (albumId) this.#addAlbumHash(database, accountId, albumId, hash)
		return {status: 'duplicate' as const, itemId: hashToId(hash)}
	}

	moveItems(
		database: Database,
		source: {accountId: string; rootVirtualPath: string; relativePath: string},
		destination: {accountId: string; rootVirtualPath: string; relativePath: string},
	) {
		const references: PhotoContentReference[] = []
		for (const location of [source, destination]) {
			const row = database
				.prepare(
					`SELECT contents.blake3 FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN contents ON contents.id = entries.content_id
					WHERE index_roots.owner_id = ? AND index_roots.virtual_path = ?
						AND entries.relative_path = ?`,
				)
				.get(location.accountId, location.rootVirtualPath, location.relativePath) as {blake3: Buffer} | undefined
			if (row) references.push({accountId: location.accountId, hash: row.blake3})
		}
		this.refreshEffectiveTakenAt(
			database,
			groupContentReferences(references).map(([accountId, hashes]) => ({accountId, hashes})),
		)
		return references.length > 0
	}

	listItems(database: Database, accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		this.#ensureSource(database, accountId)
		if (isDefaultTimelineFilter(filter)) return this.#listIndexedTimeline(database, accountId, cursor, limit)
		const where = filterQuery(filter)
		if (cursor) {
			const decoded = decodeCursor(cursor)
			where.sql += ' AND (logical_taken_at < ? OR (logical_taken_at = ? AND id > ?))'
			where.parameters.push(decoded.takenAt, decoded.takenAt, decoded.id)
		}
		const parameters = [accountId, ...where.parameters]
		const rows = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} ${ITEM_SELECT} FROM logical_items
				WHERE ${where.sql} ORDER BY logical_taken_at DESC, id LIMIT ?`,
			)
			.all(...parameters, limit + 1) as ItemRow[]
		const page = rows.slice(0, limit)
		const total = cursor
			? undefined
			: Number(
					(
						database
							.prepare(`${PHOTO_LIBRARY_CTE} SELECT COUNT(*) AS count FROM logical_items WHERE ${where.sql}`)
							.get(...parameters) as {count: number}
					).count,
				)
		const last = page.at(-1)
		return {
			items: page.map(item),
			...(total === undefined ? {} : {total}),
			...(rows.length > limit && last ? {nextCursor: encodeCursor(Number(last.taken_at), last.id)} : {}),
		}
	}

	#listIndexedTimeline(database: Database, accountId: string, cursor: string | undefined, limit: number) {
		const cursorValue = cursor ? decodeCursor(cursor) : undefined
		const cursorHash = cursorValue ? idToHash(cursorValue.id)! : undefined
		const candidates = database
			.prepare(
				`SELECT content_hash FROM umbrel.photos_content_state AS state
					INDEXED BY photos_content_state_by_effective_taken_at
				WHERE account_id = ? AND effective_taken_at IS NOT NULL
					${cursorValue ? 'AND (effective_taken_at < ? OR (effective_taken_at = ? AND content_hash > ?))' : ''}
				ORDER BY effective_taken_at DESC, content_hash LIMIT ?`,
			)
			.all(
				accountId,
				...(cursorValue ? [cursorValue.takenAt, cursorValue.takenAt, cursorHash] : []),
				limit + 1,
			) as Array<{content_hash: Buffer}>
		const hashes = candidates.map(({content_hash}) => content_hash)
		const target = targetedHashes(hashes)
		const rows =
			target === undefined
				? []
				: (this.#prepare(
						database,
						`timeline-items:${target.capacity}`,
						`${photoLibraryCte(target.capacity)} ${ITEM_SELECT} FROM logical_items
							JOIN (
								SELECT account_id, content_hash, effective_taken_at
								FROM umbrel.photos_content_state
							) AS timeline_state ON timeline_state.account_id = logical_items.account_id
								AND timeline_state.content_hash = logical_items.content_hash
							WHERE logical_items.root_kind = 'home'
								AND logical_items.content_hash IN (SELECT content_hash FROM requested_hashes)
							ORDER BY timeline_state.effective_taken_at DESC, logical_items.content_hash`,
					).all(...target.parameters, accountId) as ItemRow[])
		const page = rows.slice(0, limit)
		const total = cursor
			? undefined
			: Number(
					(
						database
							.prepare(
								`SELECT COUNT(*) AS count FROM umbrel.photos_content_state
								WHERE account_id = ? AND effective_taken_at IS NOT NULL`,
							)
							.get(accountId) as {count: number}
					).count,
				)
		const last = page.at(-1)
		return {
			items: page.map(item),
			...(total === undefined ? {} : {total}),
			...(rows.length > limit && last ? {nextCursor: encodeCursor(Number(last.taken_at), last.id)} : {}),
		}
	}

	getItem(database: Database, accountId: string, id: string, deleted = false): PhotoItemDetail | undefined {
		if (!idToHash(id)) return
		this.#ensureSource(database, accountId)
		const row = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} ${ITEM_SELECT}, COALESCE((
					SELECT named_resource.original_filename
					FROM umbrel.photos_source_resources AS named_resource
					WHERE named_resource.account_id = logical_items.account_id
						AND named_resource.source_id = logical_items.source_id
						AND named_resource.content_hash = logical_items.content_hash
						AND named_resource.original_filename IS NOT NULL
					ORDER BY named_resource.resource_key LIMIT 1
				), name) AS file_name,
				size AS size_bytes,
				source_id, source_name, source_type, root_virtual_path, relative_path,
				logical_created_at AS created_at, imported_at,
				camera_make, camera_model, lens, focal_length, aperture, exposure,
				iso, latitude, longitude, altitude, user_comment
				FROM logical_items WHERE id = ? AND root_kind = ?`,
			)
			.get(accountId, id, deleted ? 'trash' : 'home') as ItemDetailRow | undefined
		if (!row) return
		const albums = database
			.prepare(
				`SELECT umbrel.photos_albums.id, umbrel.photos_albums.name FROM umbrel.photos_album_items
				JOIN umbrel.photos_albums ON umbrel.photos_albums.id = umbrel.photos_album_items.album_id
				WHERE umbrel.photos_album_items.content_hash = ? AND umbrel.photos_albums.account_id = ?
				ORDER BY umbrel.photos_albums.created_at, umbrel.photos_albums.id`,
			)
			.all(idToHash(id)!, accountId) as Array<{id: string; name: string}>
		return itemDetail(row, albums)
	}

	neighbors(database: Database, accountId: string, id: string, filter: PhotoFilter) {
		if (!idToHash(id)) return
		this.#ensureSource(database, accountId)
		const where = filterQuery(filter)
		const current = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} SELECT logical_taken_at AS taken_at, id FROM logical_items
				WHERE id = ? AND ${where.sql}`,
			)
			.get(accountId, id, ...where.parameters) as {taken_at: number; id: string} | undefined
		if (!current) return
		const previous = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} SELECT id FROM logical_items WHERE ${where.sql}
				AND (logical_taken_at > ? OR (logical_taken_at = ? AND id < ?))
				ORDER BY logical_taken_at ASC, id DESC LIMIT 1`,
			)
			.get(accountId, ...where.parameters, current.taken_at, current.taken_at, current.id) as {id: string} | undefined
		const next = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} SELECT id FROM logical_items WHERE ${where.sql}
				AND (logical_taken_at < ? OR (logical_taken_at = ? AND id > ?))
				ORDER BY logical_taken_at DESC, id LIMIT 1`,
			)
			.get(accountId, ...where.parameters, current.taken_at, current.taken_at, current.id) as {id: string} | undefined
		return {...(previous ? {prevId: previous.id} : {}), ...(next ? {nextId: next.id} : {})}
	}

	summary(database: Database, accountId: string) {
		this.#ensureSource(database, accountId)
		const row = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} SELECT
					COUNT(*) FILTER (WHERE root_kind = 'home') AS items,
					COUNT(*) FILTER (WHERE root_kind = 'home' AND is_favorite = 1) AS favorites,
					COUNT(*) FILTER (WHERE root_kind = 'home' AND kind = 'photo') AS photos,
					COUNT(*) FILTER (WHERE root_kind = 'home' AND kind = 'video') AS videos,
					COUNT(*) FILTER (WHERE root_kind = 'trash') AS deleted,
					COALESCE(SUM(size) FILTER (WHERE root_kind = 'home'), 0) AS size_bytes
				FROM logical_items`,
			)
			.get(accountId) as Record<string, number>
		const subKinds = Object.fromEntries(
			(
				database
					.prepare(
						`${PHOTO_LIBRARY_CTE} SELECT logical_sub_kind AS value, COUNT(*) AS count
						FROM logical_items WHERE root_kind = 'home' AND logical_sub_kind IS NOT NULL
						GROUP BY logical_sub_kind`,
					)
					.all(accountId) as Array<{value: string; count: number}>
			).map(({value, count}) => [value, Number(count)]),
		)
		const bySource = Object.fromEntries(
			(
				database
					.prepare(
						`${PHOTO_LIBRARY_CTE} SELECT source.id AS value, COUNT(*) AS count
						FROM umbrel.photos_sources AS source JOIN logical_items ON logical_items.root_kind = 'home'
							AND EXISTS (SELECT 1 FROM authorized_locations AS location
								WHERE location.content_hash = logical_items.content_hash
									AND location.root_kind = logical_items.root_kind AND location.source_id = source.id)
						WHERE source.account_id = ? GROUP BY source.id`,
					)
					.all(accountId, accountId) as Array<{value: string; count: number}>
			).map(({value, count}) => [value, Number(count)]),
		)
		const months = (
			database
				.prepare(
					`${PHOTO_LIBRARY_CTE} SELECT
						CAST(strftime('%Y', logical_taken_at / 1000, 'unixepoch') AS INTEGER) AS year,
						CAST(strftime('%m', logical_taken_at / 1000, 'unixepoch') AS INTEGER) AS month,
						COUNT(*) AS count FROM logical_items WHERE root_kind = 'home'
					GROUP BY year, month ORDER BY year DESC, month DESC`,
				)
				.all(accountId) as Array<{year: number; month: number; count: number}>
		).map(({year, month, count}) => ({year: Number(year), month: Number(month), count: Number(count)}))
		return {
			counts: {
				items: Number(row.items),
				favorites: Number(row.favorites),
				photos: Number(row.photos),
				videos: Number(row.videos),
				deleted: Number(row.deleted),
			},
			sizeBytes: Number(row.size_bytes),
			bySubKind: {
				live: Number(subKinds.live ?? 0),
				panorama: Number(subKinds.panorama ?? 0),
				screenshot: Number(subKinds.screenshot ?? 0),
				spherical: Number(subKinds.spherical ?? 0),
			},
			bySource,
			months,
		}
	}

	setFavorite(database: Database, accountId: string, ids: string[], favorite: boolean) {
		const hashes = this.#accessibleHashes(database, accountId, ids)
		let changes = 0
		for (const hash of hashes) {
			if (this.#ensureContentState(database, accountId, hash)) {
				this.#refreshEffectiveTakenAt(database, accountId, [hash])
			}
			changes += database
				.prepare(
					`UPDATE umbrel.photos_content_state SET is_favorite = ?
					WHERE account_id = ? AND content_hash = ? AND is_favorite IS NOT ?`,
				)
				.run(Number(favorite), accountId, hash, Number(favorite)).changes
		}
		return changes
	}

	resolveItems(database: Database, accountId: string, ids: string[]) {
		const hashes = uniqueBuffers(ids.map(idToHash).filter((hash): hash is Buffer => hash !== undefined))
		if (hashes.length === 0) return []
		this.#ensureSource(database, accountId)
		const resolved = new Map<string, {id: string; path: string}>()
		for (const batch of hashBatches(hashes)) {
			const target = targetedHashes(batch)!
			const rows = this.#prepare(
				database,
				`resolve-items:${target.capacity}`,
				`${photoLibraryCte(target.capacity)}
					SELECT id, root_virtual_path, relative_path FROM logical_items
					WHERE content_hash IN (SELECT content_hash FROM requested_hashes)
					ORDER BY id, root_kind = 'home' DESC`,
			).all(...target.parameters, accountId) as Array<{id: string; root_virtual_path: string; relative_path: string}>
			for (const row of rows) {
				if (!resolved.has(row.id)) {
					resolved.set(row.id, {id: row.id, path: joinVirtualPath(row.root_virtual_path, row.relative_path)})
				}
			}
		}
		return [...resolved.values()].sort((left, right) => left.id.localeCompare(right.id))
	}

	resolveItemFiles(database: Database, accountId: string, ids: string[] | undefined, rootKind: PhotoRootKind) {
		let hashes = ids ? ids.map(idToHash).filter((hash): hash is Buffer => hash !== undefined) : undefined
		if (hashes) hashes = this.#withLiveCompanions(database, accountId, hashes, rootKind)
		const hashFilter = hashes?.length ? `AND contents.blake3 IN (${hashes.map(() => '?').join(', ')})` : ''
		if (hashes && hashes.length === 0) return []
		return (
			database
				.prepare(
					`SELECT lower(hex(contents.blake3)) AS id, index_roots.virtual_path, entries.relative_path,
						entries.inode, entries.size, entries.modified_ns, entries.ctime_ns
					FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN contents ON contents.id = entries.content_id
					JOIN media_metadata ON media_metadata.content_id = contents.id AND media_metadata.state = 'ready'
					WHERE index_roots.owner_id = ? AND index_roots.kind = ? ${hashFilter}
						AND entries.type = 'file' AND entries.hidden = 0
					ORDER BY index_roots.virtual_path, entries.relative_path`,
				)
				.all(accountId, rootKind, ...(hashes ?? [])) as Array<{
				id: string
				virtual_path: string
				relative_path: string
				inode: string
				size: number
				modified_ns: string
				ctime_ns: string
			}>
		).map((row) => ({
			id: row.id,
			path: joinVirtualPath(row.virtual_path, row.relative_path),
			revision: {
				inode: row.inode,
				size: Number(row.size),
				modifiedNs: row.modified_ns,
				ctimeNs: row.ctime_ns,
			},
		}))
	}

	resolveLiveCompanion(database: Database, accountId: string, id: string) {
		const stillHash = idToHash(id)
		if (!stillHash) return
		this.#ensureSource(database, accountId)
		const row = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} SELECT lower(hex(pair.motion_hash)) AS id,
					motion.root_virtual_path, motion.relative_path
				FROM active_live_pairs AS pair
				JOIN logical_items AS still ON still.content_hash = pair.still_hash
					AND still.account_id = pair.account_id AND still.root_kind = pair.root_kind
				JOIN authorized_locations AS motion ON motion.content_hash = pair.motion_hash
					AND motion.account_id = pair.account_id AND motion.root_kind = pair.root_kind
				WHERE pair.still_hash = ?
				ORDER BY pair.root_kind = 'home' DESC, motion.root_virtual_path, motion.relative_path LIMIT 1`,
			)
			.get(accountId, stillHash) as {id: string; root_virtual_path: string; relative_path: string} | undefined
		return row ? {id: row.id, path: joinVirtualPath(row.root_virtual_path, row.relative_path)} : undefined
	}

	listAlbums(database: Database, accountId: string): PhotoAlbum[] {
		this.#ensureSource(database, accountId)
		return (
			database
				.prepare(
					`${PHOTO_LIBRARY_CTE} SELECT umbrel.photos_albums.id, umbrel.photos_albums.name, umbrel.photos_albums.created_at,
						CASE WHEN EXISTS (
							SELECT 1 FROM umbrel.photos_album_items AS chosen_membership
							JOIN logical_items AS chosen ON chosen.content_hash = chosen_membership.content_hash
							WHERE chosen_membership.album_id = umbrel.photos_albums.id
								AND chosen.content_hash = umbrel.photos_albums.cover_content_hash AND chosen.root_kind = 'home'
						) THEN lower(hex(umbrel.photos_albums.cover_content_hash)) ELSE (
							SELECT newest.id FROM umbrel.photos_album_items AS newest_membership
							JOIN logical_items AS newest ON newest.content_hash = newest_membership.content_hash
							WHERE newest_membership.album_id = umbrel.photos_albums.id AND newest.root_kind = 'home'
							ORDER BY newest.logical_taken_at DESC, newest.id LIMIT 1
						) END AS cover_id,
						COUNT(logical_items.id) FILTER (WHERE logical_items.root_kind = 'home') AS count,
						MIN(logical_items.logical_taken_at) FILTER (WHERE logical_items.root_kind = 'home') AS taken_from,
						MAX(logical_items.logical_taken_at) FILTER (WHERE logical_items.root_kind = 'home') AS taken_to
					FROM umbrel.photos_albums
					LEFT JOIN umbrel.photos_album_items ON umbrel.photos_album_items.album_id = umbrel.photos_albums.id
					LEFT JOIN logical_items ON logical_items.content_hash = umbrel.photos_album_items.content_hash
					WHERE umbrel.photos_albums.account_id = ?
					GROUP BY umbrel.photos_albums.id ORDER BY umbrel.photos_albums.created_at, umbrel.photos_albums.id`,
				)
				.all(accountId, accountId) as Array<{
				id: string
				name: string
				created_at: number
				cover_id: string | null
				count: number
				taken_from: number | null
				taken_to: number | null
			}>
		).map((row) => ({
			id: row.id,
			name: row.name,
			count: Number(row.count),
			...(row.cover_id ? {coverId: row.cover_id} : {}),
			...(row.taken_from === null ? {} : {takenFrom: Number(row.taken_from)}),
			...(row.taken_to === null ? {} : {takenTo: Number(row.taken_to)}),
			createdAt: Number(row.created_at),
		}))
	}

	createAlbum(database: Database, accountId: string, name: string, ids: string[] = []) {
		const id = randomUUID()
		const createdAt = Date.now()
		const create = database.transaction(() => {
			database
				.prepare('INSERT INTO umbrel.photos_albums(id, account_id, name, created_at) VALUES (?, ?, ?, ?)')
				.run(id, accountId, name, createdAt)
			this.addAlbumItems(database, accountId, id, ids)
		})
		create.immediate()
		return this.listAlbums(database, accountId).find((album) => album.id === id)!
	}

	renameAlbum(database: Database, accountId: string, id: string, name: string) {
		return database
			.prepare('UPDATE umbrel.photos_albums SET name = ? WHERE id = ? AND account_id = ?')
			.run(name, id, accountId).changes
	}

	setAlbumCover(database: Database, accountId: string, id: string, itemId?: string) {
		const hash = itemId ? idToHash(itemId) : undefined
		if (itemId && !hash) return 0
		if (hash) {
			this.#ensureSource(database, accountId)
			const member = database
				.prepare(
					`${PHOTO_LIBRARY_CTE} SELECT 1 FROM umbrel.photos_album_items
					JOIN logical_items ON logical_items.content_hash = umbrel.photos_album_items.content_hash
					WHERE umbrel.photos_album_items.album_id = ? AND umbrel.photos_album_items.content_hash = ?
						AND logical_items.root_kind = 'home'`,
				)
				.get(accountId, id, hash)
			if (!member) return 0
		}
		return database
			.prepare('UPDATE umbrel.photos_albums SET cover_content_hash = ? WHERE id = ? AND account_id = ?')
			.run(hash ?? null, id, accountId).changes
	}

	deleteAlbum(database: Database, accountId: string, id: string) {
		return database.prepare('DELETE FROM umbrel.photos_albums WHERE id = ? AND account_id = ?').run(id, accountId)
			.changes
	}

	addAlbumItems(database: Database, accountId: string, albumId: string, ids: string[]) {
		if (!this.#albumExists(database, accountId, albumId)) return 0
		let changes = 0
		for (const hash of this.#accessibleHashes(database, accountId, ids)) {
			changes += this.#addAlbumHash(database, accountId, albumId, hash)
		}
		return changes
	}

	removeAlbumItems(database: Database, accountId: string, albumId: string, ids: string[]) {
		if (!this.#albumExists(database, accountId, albumId)) return 0
		let changes = 0
		for (const hash of uniqueBuffers(ids.map(idToHash).filter((value): value is Buffer => value !== undefined))) {
			changes += database
				.prepare('DELETE FROM umbrel.photos_album_items WHERE album_id = ? AND content_hash = ?')
				.run(albumId, hash).changes
		}
		return changes
	}

	listSources(database: Database, accountId: string): PhotoSource[] {
		this.#ensureSource(database, accountId)
		return (
			database
				.prepare(
					`${PHOTO_LIBRARY_CTE} SELECT source.*,
						COUNT(logical_items.id) FILTER (
							WHERE logical_items.root_kind = 'home' AND logical_items.kind = 'photo'
								AND EXISTS (SELECT 1 FROM authorized_locations AS location
									WHERE location.content_hash = logical_items.content_hash AND location.source_id = source.id)
						) AS photos,
						COUNT(logical_items.id) FILTER (
							WHERE logical_items.root_kind = 'home' AND logical_items.kind = 'video'
								AND EXISTS (SELECT 1 FROM authorized_locations AS location
									WHERE location.content_hash = logical_items.content_hash AND location.source_id = source.id)
						) AS videos,
						COALESCE(SUM(logical_items.size) FILTER (
							WHERE logical_items.root_kind = 'home'
								AND EXISTS (SELECT 1 FROM authorized_locations AS location
									WHERE location.content_hash = logical_items.content_hash AND location.source_id = source.id)
						), 0) AS size_bytes
					FROM umbrel.photos_sources AS source LEFT JOIN logical_items ON true
					WHERE source.account_id = ? GROUP BY source.id ORDER BY source.created_at`,
				)
				.all(accountId, accountId) as Array<{
				id: string
				type: 'umbrel' | 'iphone'
				name: string
				last_import_at: number | null
				created_at: number
				scope_mode: PhotoScopeMode | null
				scope_paths: string | null
				photos: number
				videos: number
				size_bytes: number
			}>
		).map((row) => ({
			id: row.id,
			type: row.type,
			name: row.name,
			...(row.last_import_at === null ? {} : {lastImportAt: Number(row.last_import_at)}),
			createdAt: Number(row.created_at),
			stats: {photos: Number(row.photos), videos: Number(row.videos), sizeBytes: Number(row.size_bytes)},
			...(row.type === 'umbrel' && row.scope_mode
				? {scope: {mode: row.scope_mode, paths: parseStringArray(row.scope_paths)}}
				: {}),
		}))
	}

	updateSource(database: Database, accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		const source = database
			.prepare('SELECT type FROM umbrel.photos_sources WHERE id = ? AND account_id = ?')
			.get(id, accountId) as {type: 'umbrel' | 'iphone'} | undefined
		if (!source) return
		if (scope) {
			if (source.type !== 'umbrel') throw new Error('[photos-source-scope-unsupported]')
			const root = (
				database.prepare("SELECT virtual_path FROM index_roots WHERE owner_id = ? AND kind = 'home'").get(accountId) as
					| {virtual_path: string}
					| undefined
			)?.virtual_path
			if (!root) throw new Error('[photos-invalid-scope-path]')
			const paths = [...new Set(scope.paths.map((path) => nodePath.posix.normalize(path)))]
			if (paths.some((path) => path !== root && !path.startsWith(`${root}/`))) {
				throw new Error('[photos-invalid-scope-path]')
			}
			const update = database.transaction(() => {
				database
					.prepare('UPDATE umbrel.photos_sources SET scope_mode = ?, scope_paths = ? WHERE id = ? AND account_id = ?')
					.run(scope.mode, JSON.stringify(paths), id, accountId)
				this.#refreshEffectiveTakenAt(database, accountId)
			})
			update.immediate()
		}
		return this.listSources(database, accountId).find((candidate) => candidate.id === id)
	}

	removeSource(database: Database, accountId: string, id: string, _keepItems: boolean) {
		const source = database
			.prepare('SELECT type FROM umbrel.photos_sources WHERE id = ? AND account_id = ?')
			.get(id, accountId) as {type: string} | undefined
		if (!source || source.type === 'umbrel') return false
		const remove = database.transaction(() => {
			const replacement = this.#ensureSource(database, accountId)
			database
				.prepare(
					`UPDATE umbrel.photos_content_state SET source_id = COALESCE((
						SELECT MIN(other.source_id) FROM umbrel.photos_source_resources AS other
						WHERE other.account_id = photos_content_state.account_id
							AND other.content_hash = photos_content_state.content_hash AND other.source_id <> ?
					), ?) WHERE source_id = ? AND account_id = ?`,
				)
				.run(id, replacement, id, accountId)
			database.prepare('DELETE FROM umbrel.photos_sources WHERE id = ? AND account_id = ?').run(id, accountId)
			this.#refreshEffectiveTakenAt(database, accountId)
		})
		remove.immediate()
		return true
	}

	removeAccount(database: Database, accountId: string) {
		const remove = database.transaction(() => {
			database.prepare('DELETE FROM umbrel.photos_content_state WHERE account_id = ?').run(accountId)
			database.prepare('DELETE FROM umbrel.photos_albums WHERE account_id = ?').run(accountId)
			return database.prepare('DELETE FROM umbrel.photos_sources WHERE account_id = ?').run(accountId).changes
		})
		return remove.immediate()
	}

	indexingState(database: Database, accountId: string): PhotoIndexingState {
		this.#ensureSource(database, accountId)
		const root = database
			.prepare("SELECT state, last_error FROM index_roots WHERE owner_id = ? AND kind = 'home'")
			.get(accountId) as {state: 'warming' | 'ready' | 'degraded'; last_error: string | null} | undefined
		if (!root || root.state === 'warming') return {phase: 'indexing'}
		const counts = database
			.prepare(
				`WITH work AS (
					SELECT CASE WHEN entries.content_id IS NULL THEN -entries.id ELSE entries.content_id END AS work_id,
						MAX(entries.hash_error IS NOT NULL OR media_metadata.state = 'failed'
							OR EXISTS (SELECT 1 FROM thumbnail_variants
								WHERE thumbnail_variants.content_id = entries.content_id
									AND thumbnail_variants.variant IN (
										'preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2'
									) AND thumbnail_variants.state = 'failed')) AS failed,
						MAX(entries.content_id IS NOT NULL AND media_metadata.state = 'ready'
							AND (SELECT COUNT(*) FROM thumbnail_variants
								WHERE thumbnail_variants.content_id = entries.content_id
									AND thumbnail_variants.variant IN (
										'preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2'
									) AND thumbnail_variants.state = 'ready') = 3) AS completed
					FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN umbrel.photos_sources AS photos_source ON photos_source.account_id = index_roots.owner_id
						AND photos_source.type = 'umbrel'
					LEFT JOIN media_metadata ON media_metadata.content_id = entries.content_id
					WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
						AND entries.type = 'file' AND entries.hidden = 0
						AND entries.thumbnail_identity_kind = 'content'
						AND (entries.content_id IS NULL OR media_metadata.content_id IS NOT NULL)
						AND ${sourceScopeSql('photos_source')}
					GROUP BY work_id
				) SELECT COUNT(*) AS total, COALESCE(SUM(completed), 0) AS completed,
					COALESCE(SUM(failed), 0) AS failures FROM work`,
			)
			.get(accountId) as {total: number; completed: number; failures: number}
		const total = Number(counts.total)
		const completed = Number(counts.completed)
		const percentage = total === 0 ? 100 : Math.floor((completed / total) * 100)
		if (root.state === 'degraded') {
			return {phase: 'degraded', completed, total, percentage, ...(root.last_error ? {error: root.last_error} : {})}
		}
		if (Number(counts.failures) > 0) {
			return {phase: 'degraded', completed, total, percentage, error: 'Some media could not be prepared'}
		}
		if (completed < total) return {phase: 'enriching', completed, total, percentage}
		return {phase: 'ready', completed, total, percentage: 100}
	}

	#ensureContentState(database: Database, accountId: string, hash: Buffer) {
		const sourceId = this.#ensureSource(database, accountId)
		return (
			database
				.prepare(
					`INSERT INTO umbrel.photos_content_state(
						account_id, content_hash, source_id, is_favorite, imported_at
					) VALUES (?, ?, ?, 0, ?)
					ON CONFLICT(account_id, content_hash) DO NOTHING`,
				)
				.run(accountId, hash, sourceId, Date.now()).changes > 0
		)
	}

	// TODO(photos-denormalization): effective_taken_at is both the Home timeline
	// sort key and its ready/visible membership marker. Any future input to
	// logical_items (authorization, canonical locations, metadata, or Live Photo
	// pairing) must invalidate and refresh the affected hashes in the same
	// transaction. Missing an invalidation can otherwise make indexed pagination
	// stale even though the broad projection remains correct.
	#refreshEffectiveTakenAt(database: Database, accountId: string, hashes?: Buffer[], advanceGeneration = true) {
		const requested = hashes ? uniqueBuffers(hashes) : undefined
		if (requested?.length === 0) return
		if (requested && requested.length > TARGETED_HASH_BATCH_SIZE) {
			for (let offset = 0; offset < requested.length; offset += TARGETED_HASH_BATCH_SIZE) {
				this.#refreshEffectiveTakenAt(
					database,
					accountId,
					requested.slice(offset, offset + TARGETED_HASH_BATCH_SIZE),
					false,
				)
			}
			if (advanceGeneration) this.#advanceProjectionGeneration(database)
			return
		}
		const target = requested ? targetedHashes(requested)! : undefined
		const cte = photoLibraryCte(target?.capacity ?? 0)
		const targetedWhere = requested ? 'AND state.content_hash IN (SELECT content_hash FROM relevant_contents)' : ''
		this.#prepare(
			database,
			`refresh-effective-taken-at:${target?.capacity ?? 0}`,
			`${cte}
				UPDATE umbrel.photos_content_state AS state
				SET effective_taken_at = (
					SELECT logical_items.logical_taken_at FROM logical_items
					WHERE logical_items.account_id = state.account_id
						AND logical_items.content_hash = state.content_hash
						AND logical_items.root_kind = 'home'
				)
				WHERE state.account_id = ? ${targetedWhere}`,
		).run(...(target?.parameters ?? []), accountId, accountId)
		if (advanceGeneration) this.#advanceProjectionGeneration(database)
	}

	#invalidateEffectiveTakenAt(database: Database, references: PhotoContentReference[]) {
		const refreshes: PhotoContentRefresh[] = []
		for (const [accountId, hashes] of groupContentReferences(references)) {
			// For ordinary mutations, only recompute affected hashes. Once a single
			// mutation touches tens of thousands of items, one account projection is
			// cheaper than compiling and executing hundreds of dependency batches.
			if (hashes.length > ACCOUNT_WIDE_REFRESH_THRESHOLD) {
				this.#invalidateEffectiveTakenAtForAccount(database, accountId)
				refreshes.push({accountId})
				continue
			}
			const related = uniqueBuffers(
				hashBatches(hashes).flatMap((batch) => {
					const target = targetedHashes(batch)!
					return (
						this.#prepare(
							database,
							`effective-date-dependencies:${target.capacity}`,
							`${photoLibraryCte(target.capacity)}
								SELECT content_hash FROM relevant_contents`,
						).all(...target.parameters, accountId) as Array<{content_hash: Buffer}>
					).map(({content_hash}) => content_hash)
				}),
			)
			if (related.length === 0) continue
			if (related.length > ACCOUNT_WIDE_REFRESH_THRESHOLD) {
				this.#invalidateEffectiveTakenAtForAccount(database, accountId)
				refreshes.push({accountId})
				continue
			}
			for (const batch of hashBatches(related)) {
				const placeholders = batch.map(() => '?').join(', ')
				database
					.prepare(
						`UPDATE umbrel.photos_content_state SET effective_taken_at = NULL
						WHERE account_id = ? AND content_hash IN (${placeholders})`,
					)
					.run(accountId, ...batch)
			}
			refreshes.push({accountId, hashes: related})
		}
		return refreshes
	}

	#invalidateEffectiveTakenAtForAccount(database: Database, accountId: string) {
		database
			.prepare('UPDATE umbrel.photos_content_state SET effective_taken_at = NULL WHERE account_id = ?')
			.run(accountId)
	}

	#pathContentReferences(
		database: Database,
		rootId: number,
		whereSql: string,
		parameters: unknown[],
	): PhotoContentReference[] {
		return (
			database
				.prepare(
					`SELECT DISTINCT index_roots.owner_id, contents.blake3
					FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id
					JOIN contents ON contents.id = entries.content_id
					WHERE entries.root_id = ? AND index_roots.kind IN ('home', 'trash')
						AND (${whereSql})`,
				)
				.all(rootId, ...parameters) as Array<{owner_id: string; blake3: Buffer}>
		).map(({owner_id, blake3}) => ({accountId: owner_id, hash: blake3}))
	}

	#prepare(database: Database, key: string, sql: string) {
		let statements = this.#preparedStatements.get(database)
		if (!statements) {
			statements = new Map()
			this.#preparedStatements.set(database, statements)
		}
		let statement = statements.get(key)
		if (!statement) {
			statement = database.prepare(sql)
			statements.set(key, statement)
		}
		return statement
	}

	#projectionGenerationMatches(database: Database) {
		return Boolean(
			(
				database
					.prepare(
						`SELECT main_state.generation = durable_state.generation AS matches
						FROM main.photos_projection_state AS main_state
						CROSS JOIN umbrel.photos_projection_state AS durable_state
						WHERE main_state.id = 1 AND durable_state.id = 1`,
					)
					.get() as {matches: number} | undefined
			)?.matches,
		)
	}

	#advanceProjectionGeneration(database: Database) {
		// WAL guarantees each database file independently, but not an attached
		// multi-database commit as a set. Advancing the same marker in both files
		// lets startup detect and repair the rare split-commit case.
		database.exec(`
			UPDATE main.photos_projection_state SET generation = generation + 1 WHERE id = 1;
			UPDATE umbrel.photos_projection_state SET generation = generation + 1 WHERE id = 1;
		`)
	}

	#synchronizeProjectionGeneration(database: Database) {
		database.exec(`
			UPDATE umbrel.photos_projection_state
			SET generation = (SELECT generation FROM main.photos_projection_state WHERE id = 1)
			WHERE id = 1;
		`)
	}

	#accessibleHashes(database: Database, accountId: string, ids: string[]) {
		const hashes = uniqueBuffers(ids.map(idToHash).filter((hash): hash is Buffer => hash !== undefined))
		if (hashes.length === 0) return []
		this.#ensureSource(database, accountId)
		const placeholders = hashes.map(() => '?').join(', ')
		return (
			database
				.prepare(
					`${PHOTO_LIBRARY_CTE} SELECT DISTINCT content_hash FROM logical_items
					WHERE content_hash IN (${placeholders})`,
				)
				.all(accountId, ...hashes) as Array<{content_hash: Buffer}>
		).map(({content_hash}) => content_hash)
	}

	#withLiveCompanions(database: Database, accountId: string, hashes: Buffer[], rootKind: PhotoRootKind) {
		if (hashes.length === 0) return []
		const unique = uniqueBuffers(hashes)
		const placeholders = unique.map(() => '?').join(', ')
		const companions = database
			.prepare(
				`${PHOTO_LIBRARY_CTE}
				SELECT DISTINCT selected.motion_hash FROM active_live_pairs AS selected
				WHERE selected.root_kind = ? AND selected.still_hash IN (${placeholders})
				AND NOT EXISTS (
					-- A shared motion file stays protected while any unselected still
					-- remains visible in either Photos projection.
					SELECT 1 FROM derived_live_pairs AS other
					WHERE other.motion_hash = selected.motion_hash
						AND other.still_hash NOT IN (${placeholders})
				)`,
			)
			.all(accountId, rootKind, ...unique, ...unique) as Array<{motion_hash: Buffer}>
		return uniqueBuffers([...unique, ...companions.map(({motion_hash}) => motion_hash)])
	}

	#addAlbumHash(database: Database, accountId: string, albumId: string, hash: Buffer) {
		if (!this.#albumExists(database, accountId, albumId)) return 0
		return database
			.prepare(
				`INSERT INTO umbrel.photos_album_items(album_id, content_hash, added_at)
				VALUES (?, ?, ?) ON CONFLICT(album_id, content_hash) DO NOTHING`,
			)
			.run(albumId, hash, Date.now()).changes
	}

	#ensureSource(database: Database, accountId: string) {
		const id = umbrelSourceId(accountId)
		database
			.prepare(
				`INSERT INTO umbrel.photos_sources(id, account_id, type, name, scope_mode, scope_paths, created_at)
				VALUES (?, ?, 'umbrel', 'Umbrel', 'everything', '[]', ?)
				ON CONFLICT DO NOTHING`,
			)
			.run(id, accountId, Date.now())
		return id
	}

	#albumExists(database: Database, accountId: string, id: string) {
		return Boolean(
			database.prepare('SELECT 1 FROM umbrel.photos_albums WHERE id = ? AND account_id = ?').get(id, accountId),
		)
	}
}

function filterQuery(filter: PhotoFilter): Query {
	const clauses = ['root_kind = ?']
	const parameters: unknown[] = [filter.deleted ? 'trash' : 'home']
	if (filter.kind) {
		clauses.push('kind = ?')
		parameters.push(filter.kind)
	}
	if (filter.subKind) {
		clauses.push('logical_sub_kind = ?')
		parameters.push(filter.subKind)
	}
	if (filter.favorite !== undefined) {
		clauses.push('is_favorite = ?')
		parameters.push(Number(filter.favorite))
	}
	if (filter.sourceIds?.length) {
		clauses.push(
			`EXISTS (SELECT 1 FROM authorized_locations AS source_match
			WHERE source_match.content_hash = logical_items.content_hash
				AND source_match.root_kind = logical_items.root_kind
				AND source_match.source_id IN (${filter.sourceIds.map(() => '?').join(', ')}))`,
		)
		parameters.push(...filter.sourceIds)
	}
	if (filter.albumIds?.length) {
		clauses.push(
			`EXISTS (SELECT 1 FROM umbrel.photos_album_items
			JOIN umbrel.photos_albums ON umbrel.photos_albums.id = umbrel.photos_album_items.album_id
			WHERE umbrel.photos_album_items.content_hash = logical_items.content_hash
				AND umbrel.photos_albums.account_id = logical_items.account_id
				AND umbrel.photos_album_items.album_id IN (${filter.albumIds.map(() => '?').join(', ')}))`,
		)
		parameters.push(...filter.albumIds)
	}
	if (filter.dates?.length) {
		clauses.push(`(${filter.dates.map(() => '(logical_taken_at >= ? AND logical_taken_at < ?)').join(' OR ')})`)
		for (const range of filter.dates) parameters.push(range.from, range.to)
	}
	const terms = filter.query?.replaceAll('\0', '').normalize('NFC').trim().split(/\s+/).filter(Boolean) ?? []
	for (const term of terms) {
		if (Array.from(term).length >= 3) {
			clauses.push(
				`EXISTS (SELECT 1 FROM authorized_locations AS search_location
				WHERE search_location.content_hash = logical_items.content_hash
					AND search_location.root_kind = logical_items.root_kind AND (
					search_location.entry_id IN (
						SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH ?
					) OR search_location.content_id IN (
						SELECT rowid FROM media_metadata_fts WHERE media_metadata_fts MATCH ?
					)
				))`,
			)
			const expression = ftsTrigramExpression(term)
			parameters.push(expression, expression)
		} else {
			clauses.push(
				`EXISTS (SELECT 1 FROM authorized_locations AS search_location
				WHERE search_location.content_hash = logical_items.content_hash
					AND search_location.root_kind = logical_items.root_kind
					AND (instr(search_location.search_name_folded, ?) > 0
						OR instr(search_location.search_text, ?) > 0))`,
			)
			const folded = foldSearchName(term)
			parameters.push(folded, folded)
		}
	}
	return {sql: clauses.join(' AND '), parameters}
}

function isDefaultTimelineFilter(filter: PhotoFilter) {
	// TODO(photos-indexed-timeline): Filters added to this fast path must either
	// be represented by photos_content_state or hydrate bounded candidate batches.
	// Joining the full logical_items projection before LIMIT would silently bring
	// back the library-wide sort this path exists to avoid.
	return (
		!filter.deleted &&
		filter.kind === undefined &&
		filter.subKind === undefined &&
		filter.favorite === undefined &&
		!filter.sourceIds?.length &&
		!filter.albumIds?.length &&
		!filter.dates?.length &&
		!filter.query?.trim()
	)
}

function sourceScopeSql(
	source = 'umbrel.photos_sources',
	root = 'index_roots',
	entry = 'entries',
	rootVirtualPathColumn = 'virtual_path',
) {
	const virtualPath = `(${root}.${rootVirtualPathColumn} || '/' || ${entry}.relative_path)`
	const containsPath = `${virtualPath} = value OR (${virtualPath} >= value || '/' AND ${virtualPath} < value || '0')`
	return `(
		${source}.scope_mode IS NULL OR ${source}.scope_mode = 'everything'
		OR (${source}.scope_mode = 'only' AND EXISTS (
			SELECT 1 FROM json_each(${source}.scope_paths) WHERE ${containsPath}
		))
		OR (${source}.scope_mode = 'everything-except' AND NOT EXISTS (
			SELECT 1 FROM json_each(${source}.scope_paths) WHERE ${containsPath}
		))
	)`
}

function item(row: ItemRow): PhotoItem {
	return {
		id: row.id,
		kind: row.kind,
		...(row.sub_kind ? {subKind: row.sub_kind} : {}),
		takenAt: Number(row.taken_at),
		...(row.taken_at_offset_minutes === null ? {} : {takenAtOffsetMinutes: Number(row.taken_at_offset_minutes)}),
		width: Number(row.width),
		height: Number(row.height),
		...(row.duration_ms === null ? {} : {durationMs: Number(row.duration_ms)}),
		isFavorite: Boolean(row.is_favorite),
		...(row.tint === null ? {} : {tint: Number(row.tint)}),
	}
}

function itemDetail(row: ItemDetailRow, albums: Array<{id: string; name: string}>): PhotoItemDetail {
	const exifFields = {
		...(row.camera_make ? {make: row.camera_make} : {}),
		...(row.camera_model ? {model: row.camera_model} : {}),
		...(row.lens ? {lens: row.lens} : {}),
		...(row.focal_length ? {focalLength: row.focal_length} : {}),
		...(row.aperture ? {aperture: row.aperture} : {}),
		...(row.exposure ? {exposure: row.exposure} : {}),
		...(row.iso === null ? {} : {iso: Number(row.iso)}),
		...(row.user_comment ? {userComment: row.user_comment} : {}),
	}
	const exif = Object.keys(exifFields).length > 0 ? exifFields : undefined
	return {
		...item(row),
		fileName: row.file_name,
		sizeBytes: Number(row.size_bytes),
		source: {id: row.source_id, name: row.source_name, type: row.source_type},
		path: joinVirtualPath(row.root_virtual_path, row.relative_path),
		createdAt: Number(row.created_at),
		importedAt: Number(row.imported_at),
		...(exif ? {exif} : {}),
		...(row.latitude === null || row.longitude === null
			? {}
			: {
					location: {
						lat: Number(row.latitude),
						lng: Number(row.longitude),
						...(row.altitude === null ? {} : {altitude: Number(row.altitude)}),
					},
				}),
		albums,
	}
}

function encodeCursor(takenAt: number, id: string) {
	return Buffer.from(JSON.stringify([takenAt, id])).toString('base64url')
}

function decodeCursor(cursor: string) {
	try {
		const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown
		if (
			!Array.isArray(value) ||
			value.length !== 2 ||
			typeof value[0] !== 'number' ||
			typeof value[1] !== 'string' ||
			!HASH_PATTERN.test(value[1])
		) {
			throw new TypeError('Invalid Photos cursor')
		}
		return {takenAt: value[0], id: value[1]}
	} catch {
		throw new TypeError('Invalid Photos cursor')
	}
}

function parseStringArray(value: string | null) {
	try {
		const parsed = JSON.parse(value ?? '[]') as unknown
		return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
	} catch {
		return []
	}
}

function umbrelSourceId(accountId: string) {
	return `umbrel:${accountId}`
}

function joinVirtualPath(root: string, relativePath: string) {
	return relativePath ? `${root}/${relativePath}` : root
}

function isPhotoRootKind(kind: string): kind is PhotoRootKind {
	return kind === 'home' || kind === 'trash'
}

function idToHash(id: string): Buffer | undefined {
	return HASH_PATTERN.test(id) ? Buffer.from(id, 'hex') : undefined
}

function hashToId(hash: Buffer) {
	return hash.toString('hex')
}

function uniqueBuffers(values: Buffer[]) {
	return [...new Map(values.map((value) => [hashToId(value), value])).values()]
}

// A small set of reusable placeholder counts keeps the prepared-statement cache
// bounded. NULL padding is discarded by requested_hashes in the targeted CTE.
function targetedHashes(hashes: Buffer[]) {
	if (hashes.length === 0) return
	let capacity = 1
	while (capacity < hashes.length) capacity *= 2
	return {
		capacity,
		parameters: [...hashes, ...Array<null>(capacity - hashes.length).fill(null)],
	}
}

function hashBatches(hashes: Buffer[]) {
	const batches: Buffer[][] = []
	for (let offset = 0; offset < hashes.length; offset += TARGETED_HASH_BATCH_SIZE) {
		batches.push(hashes.slice(offset, offset + TARGETED_HASH_BATCH_SIZE))
	}
	return batches
}

function groupContentReferences(references: PhotoContentReference[]) {
	const grouped = new Map<string, Buffer[]>()
	for (const {accountId, hash} of references) grouped.set(accountId, [...(grouped.get(accountId) ?? []), hash])
	return [...grouped].map(([accountId, hashes]) => [accountId, uniqueBuffers(hashes)] as const)
}

function ftsTrigramExpression(term: string) {
	const characters = Array.from(term)
	const trigrams = new Set<string>()
	for (let index = 0; index <= characters.length - 3; index++) {
		trigrams.add(characters.slice(index, index + 3).join(''))
	}
	return [...trigrams].map((value) => `"${value.replaceAll('"', '""')}"`).join(' AND ')
}
