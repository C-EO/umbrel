import {randomUUID} from 'node:crypto'
import nodePath from 'node:path'

import type DatabaseTypes from 'better-sqlite3'

import {foldSearchName} from '../files/file-index/migrations.js'
import type {
	PhotoAlbum,
	PhotoFilter,
	PhotoIndexingState,
	PhotoItem,
	PhotoItemDetail,
	PhotoScopeMode,
	PhotoSource,
} from './types.js'
import {supportsPhotos} from './types.js'

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

type LivePairLocation = {
	account_id: string
	content_id: number
	content_hash: Buffer
	root_virtual_path: string
	relative_path: string
	kind: 'photo' | 'video'
	live_identifier: string | null
	duration_ms: number | null
}

const HASH_PATTERN = /^[a-f0-9]{64}$/

const PHOTO_LIBRARY_CTE = `
	WITH authorized_locations AS (
		SELECT index_roots.owner_id AS account_id,
			contents.blake3 AS content_hash, lower(hex(contents.blake3)) AS id,
			contents.created_at AS content_created_at,
			entries.id AS entry_id, entries.content_id, entries.name, entries.search_name_folded,
			entries.size, entries.modified_ms, entries.birthtime_ms, entries.relative_path,
			index_roots.virtual_path AS root_virtual_path,
			photos_source.id AS source_id, photos_source.name AS source_name, photos_source.type AS source_type,
			media_metadata.kind, media_metadata.sub_kind, media_metadata.taken_at,
			media_metadata.taken_at_offset_minutes, media_metadata.created_at,
			media_metadata.width, media_metadata.height, media_metadata.duration_ms, media_metadata.tint,
			media_metadata.camera_make, media_metadata.camera_model, media_metadata.lens,
			media_metadata.focal_length, media_metadata.aperture, media_metadata.exposure,
			media_metadata.iso, media_metadata.latitude, media_metadata.longitude,
			media_metadata.altitude, media_metadata.user_comment, media_metadata.search_text
		FROM index_roots
		JOIN entries ON entries.root_id = index_roots.id
		JOIN contents ON contents.id = entries.content_id
		JOIN media_metadata ON media_metadata.content_id = entries.content_id AND media_metadata.state = 'ready'
		JOIN umbrel.photos_sources AS photos_source ON photos_source.account_id = index_roots.owner_id
			AND photos_source.type = 'umbrel'
		WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
			AND entries.type = 'file' AND entries.hidden = 0
			AND ${sourceScopeSql('photos_source')}
	),
	ranked_locations AS (
		SELECT *, ROW_NUMBER() OVER (
			PARTITION BY content_hash ORDER BY root_virtual_path, relative_path
		) AS location_rank
		FROM authorized_locations
	),
	canonical_locations AS (
		SELECT * FROM ranked_locations WHERE location_rank = 1
	),
	active_live_pairs AS (
		SELECT pair.account_id, pair.still_hash, pair.motion_hash
		FROM umbrel.photos_live_pairs AS pair
		WHERE EXISTS (
			SELECT 1 FROM authorized_locations AS still
			WHERE still.account_id = pair.account_id AND still.content_hash = pair.still_hash
		) AND EXISTS (
			SELECT 1 FROM authorized_locations AS motion
			WHERE motion.account_id = pair.account_id AND motion.content_hash = pair.motion_hash
		)
	),
	logical_items AS (
		SELECT canonical_locations.*,
			COALESCE(umbrel.photos_content_state.is_favorite, 0) AS is_favorite,
			umbrel.photos_content_state.deleted_at,
			COALESCE(umbrel.photos_content_state.imported_at, canonical_locations.content_created_at) AS imported_at,
			COALESCE(canonical_locations.taken_at, canonical_locations.birthtime_ms,
				canonical_locations.modified_ms) AS logical_taken_at,
			CASE
				WHEN live_pair.still_hash IS NOT NULL THEN 'live'
				WHEN canonical_locations.sub_kind IS NOT NULL THEN canonical_locations.sub_kind
				WHEN lower(canonical_locations.name) LIKE 'screenshot%'
					OR lower(canonical_locations.name) LIKE 'screen shot%'
					OR (lower(canonical_locations.name) GLOB '*.png'
						AND canonical_locations.camera_make IS NULL AND canonical_locations.camera_model IS NULL)
				THEN 'screenshot'
				ELSE NULL
			END AS logical_sub_kind
		FROM canonical_locations
		LEFT JOIN umbrel.photos_content_state ON umbrel.photos_content_state.account_id = canonical_locations.account_id
			AND umbrel.photos_content_state.content_hash = canonical_locations.content_hash
		LEFT JOIN active_live_pairs AS live_pair ON live_pair.account_id = canonical_locations.account_id
			AND live_pair.still_hash = canonical_locations.content_hash
		WHERE NOT EXISTS (
			SELECT 1 FROM active_live_pairs AS hidden_motion
			WHERE hidden_motion.account_id = canonical_locations.account_id
				AND hidden_motion.motion_hash = canonical_locations.content_hash
		)
	)`

const ITEM_SELECT = `
	SELECT id, kind, logical_sub_kind AS sub_kind, logical_taken_at AS taken_at,
		taken_at_offset_minutes, width, height, duration_ms, is_favorite, tint`

export default class PhotosRepository {
	syncEntry(database: Database, entry: IndexedPhotoEntry) {
		const root = database.prepare('SELECT owner_id, kind FROM index_roots WHERE id = ?').get(entry.rootId) as
			| {owner_id: string; kind: string}
			| undefined
		if (!root || root.kind !== 'home') return false
		this.#ensureSource(database, root.owner_id)
		if (entry.type !== 'file' || entry.hidden || !supportsPhotos(entry.name)) return true
		const content = database
			.prepare(
				`SELECT contents.blake3, entries.content_id FROM entries
				JOIN contents ON contents.id = entries.content_id
				WHERE entries.root_id = ? AND entries.relative_path = ?`,
			)
			.get(entry.rootId, entry.relativePath) as {blake3: Buffer; content_id: number} | undefined
		if (content) {
			this.#ensureContentState(database, root.owner_id, content.blake3)
			this.refreshLivePairs(database, content.content_id)
		}
		return true
	}

	detachPath(_database: Database, _rootId: number, _relativePath: string) {
		return false
	}

	detachUnseen(_database: Database, _rootId: number) {
		return false
	}

	syncAll(database: Database, accountId?: string) {
		const accounts = database
			.prepare(
				`SELECT DISTINCT owner_id FROM index_roots
				WHERE kind = 'home' ${accountId ? 'AND owner_id = ?' : ''}`,
			)
			.all(...(accountId ? [accountId] : [])) as Array<{owner_id: string}>
		let changed = false
		for (const {owner_id: ownerId} of accounts) {
			const sourceId = this.#ensureSource(database, ownerId)
			const result = database
				.prepare(
					`INSERT INTO umbrel.photos_content_state(
						account_id, content_hash, source_id, is_favorite, imported_at
					)
					SELECT ?, contents.blake3, ?, 0, MIN(contents.created_at)
					FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN contents ON contents.id = entries.content_id
					JOIN media_metadata ON media_metadata.content_id = contents.id
					WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
						AND entries.type = 'file' AND entries.hidden = 0
					GROUP BY contents.blake3
					ON CONFLICT(account_id, content_hash) DO NOTHING`,
				)
				.run(ownerId, sourceId, ownerId)
			changed = result.changes > 0 || changed
			changed = this.refreshLivePairsForAccount(database, ownerId) || changed
		}
		return changed
	}

	attachContentHash(database: Database, entryId: number, hash: Buffer) {
		const root = database
			.prepare(
				`SELECT index_roots.owner_id, index_roots.kind FROM entries
				JOIN index_roots ON index_roots.id = entries.root_id
				WHERE entries.id = ?`,
			)
			.get(entryId) as {owner_id: string; kind: string} | undefined
		if (!root || root.kind !== 'home') return false
		return this.#ensureContentState(database, root.owner_id, hash)
	}

	accountIdsForContent(database: Database, contentId: number) {
		return (
			database
				.prepare(
					`SELECT DISTINCT index_roots.owner_id FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.content_id = ? AND index_roots.kind = 'home'`,
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
					WHERE entries.id = ? AND index_roots.kind = 'home'`,
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
		this.#ensureContentState(database, accountId, uploaded.blake3)
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
					AND umbrel.photos_content_state.deleted_at IS NULL
					AND ${sourceScopeSql('photos_source')}
				LIMIT 1`,
			)
			.get(accountId, hash)
		if (!duplicate) return {status: 'new' as const}
		this.#ensureContentState(database, accountId, hash)
		if (albumId) this.#addAlbumHash(database, accountId, albumId, hash)
		return {status: 'duplicate' as const, itemId: hashToId(hash)}
	}

	refreshLivePairs(database: Database, contentId: number) {
		const accounts = this.accountIdsForContent(database, contentId)
		let changed = false
		for (const accountId of accounts)
			changed = this.#refreshLivePairsTouchingContent(database, accountId, contentId) || changed
		return changed
	}

	refreshLivePairsForAccount(database: Database, accountId: string) {
		const previous = database
			.prepare('SELECT still_hash, motion_hash FROM umbrel.photos_live_pairs WHERE account_id = ? ORDER BY still_hash')
			.all(accountId) as Array<{still_hash: Buffer; motion_hash: Buffer}>
		const stillGroups = new Map<string, LivePairLocation[]>()
		for (const location of this.#liveLocations(database, accountId, 'photo')) {
			const key = hashToId(location.content_hash)
			stillGroups.set(key, [...(stillGroups.get(key) ?? []), location])
		}
		const videos = this.#liveLocations(database, accountId, 'video')
		const replace = database.transaction(() => {
			database
				.prepare(
					`DELETE FROM umbrel.photos_live_pairs AS pair WHERE account_id = ? AND NOT (
						EXISTS (SELECT 1 FROM umbrel.photos_content_state AS still_state
							WHERE still_state.account_id = pair.account_id
								AND still_state.content_hash = pair.still_hash AND still_state.deleted_at IS NOT NULL)
						AND EXISTS (SELECT 1 FROM umbrel.photos_content_state AS motion_state
							WHERE motion_state.account_id = pair.account_id
								AND motion_state.content_hash = pair.motion_hash AND motion_state.deleted_at IS NOT NULL)
					)`,
				)
				.run(accountId)
			const insert = database.prepare(
				`INSERT INTO umbrel.photos_live_pairs(account_id, still_hash, motion_hash, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(account_id, still_hash) DO UPDATE SET motion_hash = excluded.motion_hash,
					updated_at = excluded.updated_at`,
			)
			for (const stills of stillGroups.values()) {
				const candidate = bestLiveCandidate(stills, videos)
				if (candidate) insert.run(accountId, stills[0]!.content_hash, candidate.content_hash, Date.now())
			}
		})
		replace.immediate()
		const current = database
			.prepare('SELECT still_hash, motion_hash FROM umbrel.photos_live_pairs WHERE account_id = ? ORDER BY still_hash')
			.all(accountId) as Array<{still_hash: Buffer; motion_hash: Buffer}>
		return !samePairRows(previous, current)
	}

	moveItems(
		_database: Database,
		_source: {accountId: string; rootVirtualPath: string; relativePath: string},
		_destination: {accountId: string; rootVirtualPath: string; relativePath: string},
	) {
		return false
	}

	listItems(database: Database, accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		this.#ensureSource(database, accountId)
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

	getItem(database: Database, accountId: string, id: string): PhotoItemDetail | undefined {
		if (!idToHash(id)) return
		this.#ensureSource(database, accountId)
		const row = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} ${ITEM_SELECT}, name AS file_name, size AS size_bytes,
				source_id, source_name, source_type, root_virtual_path, relative_path,
				COALESCE(created_at, birthtime_ms, modified_ms) AS created_at, imported_at,
				camera_make, camera_model, lens, focal_length, aperture, exposure,
				iso, latitude, longitude, altitude, user_comment
				FROM logical_items WHERE id = ?`,
			)
			.get(accountId, id) as ItemDetailRow | undefined
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
		const current = database
			.prepare(`${PHOTO_LIBRARY_CTE} SELECT logical_taken_at AS taken_at, id FROM logical_items WHERE id = ?`)
			.get(accountId, id) as {taken_at: number; id: string} | undefined
		if (!current) return
		const where = filterQuery(filter)
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
					COUNT(*) FILTER (WHERE deleted_at IS NULL) AS items,
					COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_favorite = 1) AS favorites,
					COUNT(*) FILTER (WHERE deleted_at IS NULL AND kind = 'photo') AS photos,
					COUNT(*) FILTER (WHERE deleted_at IS NULL AND kind = 'video') AS videos,
					COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
					COALESCE(SUM(size) FILTER (WHERE deleted_at IS NULL), 0) AS size_bytes
				FROM logical_items`,
			)
			.get(accountId) as Record<string, number>
		const subKinds = Object.fromEntries(
			(
				database
					.prepare(
						`${PHOTO_LIBRARY_CTE} SELECT logical_sub_kind AS value, COUNT(*) AS count
						FROM logical_items WHERE deleted_at IS NULL AND logical_sub_kind IS NOT NULL
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
						FROM umbrel.photos_sources AS source JOIN logical_items ON logical_items.deleted_at IS NULL
							AND EXISTS (SELECT 1 FROM authorized_locations AS location
								WHERE location.content_hash = logical_items.content_hash AND location.source_id = source.id)
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
						COUNT(*) AS count FROM logical_items WHERE deleted_at IS NULL
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
			this.#ensureContentState(database, accountId, hash)
			changes += database
				.prepare(
					`UPDATE umbrel.photos_content_state SET is_favorite = ?
					WHERE account_id = ? AND content_hash = ? AND is_favorite IS NOT ?`,
				)
				.run(Number(favorite), accountId, hash, Number(favorite)).changes
		}
		return changes
	}

	setDeleted(database: Database, accountId: string, ids: string[], deleted: boolean) {
		let hashes = this.#accessibleHashes(database, accountId, ids)
		hashes = this.#withLiveCompanions(database, accountId, hashes)
		const update = database.transaction(() => {
			let changes = 0
			for (const hash of hashes) {
				this.#ensureContentState(database, accountId, hash)
				const deletedAt = deleted ? Date.now() : null
				changes += database
					.prepare(
						`UPDATE umbrel.photos_content_state SET deleted_at = ?
						WHERE account_id = ? AND content_hash = ? AND deleted_at IS NOT ?`,
					)
					.run(deletedAt, accountId, hash, deletedAt).changes
				if (!deleted) {
					database
						.prepare('DELETE FROM umbrel.photos_deletion_targets WHERE account_id = ? AND content_hash = ?')
						.run(accountId, hash)
					continue
				}
				const locations = database
					.prepare(
						`SELECT index_roots.virtual_path, entries.relative_path
						FROM index_roots
						JOIN entries ON entries.root_id = index_roots.id
						JOIN contents ON contents.id = entries.content_id
						WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
							AND contents.blake3 = ? AND entries.type = 'file' AND entries.hidden = 0`,
					)
					.all(accountId, hash) as Array<{
					virtual_path: string
					relative_path: string
				}>
				const remember = database.prepare(
					`INSERT INTO umbrel.photos_deletion_targets(account_id, content_hash, virtual_path)
					VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
				)
				for (const location of locations) {
					remember.run(accountId, hash, joinVirtualPath(location.virtual_path, location.relative_path))
				}
			}
			return changes
		})
		return update.immediate()
	}

	deleteItems(database: Database, accountId: string, ids: string[], includeLiveCompanions = true) {
		let hashes = ids.map(idToHash).filter((hash): hash is Buffer => hash !== undefined)
		if (includeLiveCompanions) hashes = this.#withLiveCompanions(database, accountId, hashes)
		if (hashes.length === 0) return 0
		const remove = database.transaction(() => {
			let changes = 0
			for (const hash of uniqueBuffers(hashes)) {
				database
					.prepare(
						`DELETE FROM umbrel.photos_album_items WHERE content_hash = ? AND EXISTS (
							SELECT 1 FROM umbrel.photos_albums WHERE umbrel.photos_albums.id = umbrel.photos_album_items.album_id
								AND umbrel.photos_albums.account_id = ?
						)`,
					)
					.run(hash, accountId)
				database
					.prepare(
						`UPDATE umbrel.photos_albums SET cover_content_hash = NULL
						WHERE account_id = ? AND cover_content_hash = ?`,
					)
					.run(accountId, hash)
				database
					.prepare(
						`DELETE FROM umbrel.photos_live_pairs WHERE account_id = ?
							AND (still_hash = ? OR motion_hash = ?)`,
					)
					.run(accountId, hash, hash)
				changes += database
					.prepare(
						`DELETE FROM umbrel.photos_content_state
						WHERE account_id = ? AND content_hash = ? AND deleted_at IS NOT NULL`,
					)
					.run(accountId, hash).changes
			}
			return changes
		})
		return remove.immediate()
	}

	resolveItems(database: Database, accountId: string, ids: string[]) {
		const validIds = [...new Set(ids.filter((id) => idToHash(id)))]
		if (validIds.length === 0) return []
		this.#ensureSource(database, accountId)
		const placeholders = validIds.map(() => '?').join(', ')
		return (
			database
				.prepare(
					`${PHOTO_LIBRARY_CTE} SELECT id, root_virtual_path, relative_path FROM logical_items
					WHERE id IN (${placeholders}) ORDER BY id`,
				)
				.all(accountId, ...validIds) as Array<{id: string; root_virtual_path: string; relative_path: string}>
		).map((row) => ({id: row.id, path: joinVirtualPath(row.root_virtual_path, row.relative_path)}))
	}

	resolveDeletedItems(database: Database, accountId: string, ids?: string[]) {
		let hashes = ids
			? ids.map(idToHash).filter((hash): hash is Buffer => hash !== undefined)
			: (
					database
						.prepare(
							`SELECT content_hash FROM umbrel.photos_content_state
							WHERE account_id = ? AND deleted_at IS NOT NULL`,
						)
						.all(accountId) as Array<{content_hash: Buffer}>
				).map(({content_hash}) => content_hash)
		hashes = this.#withLiveCompanions(database, accountId, hashes, true)
		const rows: Array<{
			id: string
			path?: string
			revision?: {inode: string; size: number; modifiedNs: string; ctimeNs: string}
			recoverOnly?: true
			pendingRevision?: boolean
		}> = []
		const pendingHashes = Boolean(
			database
				.prepare(
					`SELECT 1 FROM index_roots LEFT JOIN entries ON entries.root_id = index_roots.id
					WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
						AND (index_roots.state = 'warming' OR (entries.type = 'file'
							AND entries.hidden = 0 AND entries.thumbnail_identity_kind = 'content'
							AND entries.content_id IS NULL)) LIMIT 1`,
				)
				.get(accountId),
		)
		for (const hash of uniqueBuffers(hashes)) {
			const state = database
				.prepare(
					`SELECT 1 FROM umbrel.photos_content_state
					WHERE account_id = ? AND content_hash = ? AND deleted_at IS NOT NULL`,
				)
				.get(accountId, hash)
			if (!state) continue
			const locations = database
				.prepare(
					`SELECT index_roots.virtual_path, entries.relative_path, entries.inode,
						entries.size, entries.modified_ns, entries.ctime_ns
					FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN contents ON contents.id = entries.content_id
					WHERE index_roots.owner_id = ? AND index_roots.kind = 'home' AND contents.blake3 = ?
						AND entries.type = 'file' AND entries.hidden = 0
					ORDER BY index_roots.virtual_path, entries.relative_path`,
				)
				.all(accountId, hash) as Array<{
				virtual_path: string
				relative_path: string
				inode: string
				size: number
				modified_ns: string
				ctime_ns: string
			}>
			const currentPaths = new Set<string>()
			for (const location of locations) {
				const path = joinVirtualPath(location.virtual_path, location.relative_path)
				currentPaths.add(path)
				rows.push({
					id: hashToId(hash),
					path,
					revision: {
						inode: location.inode,
						size: Number(location.size),
						modifiedNs: location.modified_ns,
						ctimeNs: location.ctime_ns,
					},
				})
			}
			const remembered = database
				.prepare(
					`SELECT virtual_path FROM umbrel.photos_deletion_targets
					WHERE account_id = ? AND content_hash = ? ORDER BY virtual_path`,
				)
				.all(accountId, hash) as Array<{virtual_path: string}>
			for (const target of remembered) {
				if (!currentPaths.has(target.virtual_path)) {
					rows.push({id: hashToId(hash), path: target.virtual_path, recoverOnly: true})
				}
			}
			if (locations.length === 0 && pendingHashes) rows.push({id: hashToId(hash), pendingRevision: true})
			if (locations.length === 0 && remembered.length === 0 && !pendingHashes) rows.push({id: hashToId(hash)})
		}
		return rows
	}

	resolveLiveCompanion(database: Database, accountId: string, id: string) {
		const stillHash = idToHash(id)
		if (!stillHash) return
		this.#ensureSource(database, accountId)
		const row = database
			.prepare(
				`${PHOTO_LIBRARY_CTE} SELECT lower(hex(pair.motion_hash)) AS id,
					motion.root_virtual_path, motion.relative_path
				FROM umbrel.photos_live_pairs AS pair
				JOIN authorized_locations AS motion ON motion.content_hash = pair.motion_hash
				WHERE pair.account_id = ? AND pair.still_hash = ?
					AND EXISTS (SELECT 1 FROM logical_items WHERE logical_items.content_hash = pair.still_hash)
				ORDER BY motion.root_virtual_path, motion.relative_path LIMIT 1`,
			)
			.get(accountId, accountId, stillHash) as
			| {id: string; root_virtual_path: string; relative_path: string}
			| undefined
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
								AND chosen.content_hash = umbrel.photos_albums.cover_content_hash AND chosen.deleted_at IS NULL
						) THEN lower(hex(umbrel.photos_albums.cover_content_hash)) ELSE (
							SELECT newest.id FROM umbrel.photos_album_items AS newest_membership
							JOIN logical_items AS newest ON newest.content_hash = newest_membership.content_hash
							WHERE newest_membership.album_id = umbrel.photos_albums.id AND newest.deleted_at IS NULL
							ORDER BY newest.logical_taken_at DESC, newest.id LIMIT 1
						) END AS cover_id,
						COUNT(logical_items.id) FILTER (WHERE logical_items.deleted_at IS NULL) AS count,
						MIN(logical_items.logical_taken_at) FILTER (WHERE logical_items.deleted_at IS NULL) AS taken_from,
						MAX(logical_items.logical_taken_at) FILTER (WHERE logical_items.deleted_at IS NULL) AS taken_to
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
						AND logical_items.deleted_at IS NULL`,
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
							WHERE logical_items.deleted_at IS NULL AND logical_items.kind = 'photo'
								AND EXISTS (SELECT 1 FROM authorized_locations AS location
									WHERE location.content_hash = logical_items.content_hash AND location.source_id = source.id)
						) AS photos,
						COUNT(logical_items.id) FILTER (
							WHERE logical_items.deleted_at IS NULL AND logical_items.kind = 'video'
								AND EXISTS (SELECT 1 FROM authorized_locations AS location
									WHERE location.content_hash = logical_items.content_hash AND location.source_id = source.id)
						) AS videos,
						COALESCE(SUM(logical_items.size) FILTER (
							WHERE logical_items.deleted_at IS NULL
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
			...(row.scope_mode ? {scope: {mode: row.scope_mode, paths: parseStringArray(row.scope_paths)}} : {}),
		}))
	}

	updateSource(database: Database, accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		const source = database
			.prepare('SELECT type FROM umbrel.photos_sources WHERE id = ? AND account_id = ?')
			.get(id, accountId)
		if (!source) return
		if (scope) {
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
			database
				.prepare('UPDATE umbrel.photos_sources SET scope_mode = ?, scope_paths = ? WHERE id = ? AND account_id = ?')
				.run(scope.mode, JSON.stringify(paths), id, accountId)
		}
		return this.listSources(database, accountId).find((candidate) => candidate.id === id)
	}

	removeSource(database: Database, accountId: string, id: string, keepItems: boolean) {
		const source = database
			.prepare('SELECT type FROM umbrel.photos_sources WHERE id = ? AND account_id = ?')
			.get(id, accountId) as {type: string} | undefined
		if (!source || source.type === 'umbrel') return false
		const remove = database.transaction(() => {
			if (keepItems) {
				const replacement = this.#ensureSource(database, accountId)
				database
					.prepare('UPDATE umbrel.photos_content_state SET source_id = ? WHERE source_id = ? AND account_id = ?')
					.run(replacement, id, accountId)
			} else {
				database
					.prepare('DELETE FROM umbrel.photos_content_state WHERE source_id = ? AND account_id = ?')
					.run(id, accountId)
			}
			database.prepare('DELETE FROM umbrel.photos_sources WHERE id = ? AND account_id = ?').run(id, accountId)
		})
		remove.immediate()
		return true
	}

	removeAccount(database: Database, accountId: string) {
		const remove = database.transaction(() => {
			database.prepare('DELETE FROM umbrel.photos_live_pairs WHERE account_id = ?').run(accountId)
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
						AND entries.thumbnail_identity_kind = 'content' AND ${sourceScopeSql('photos_source')}
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

	#accessibleHashes(database: Database, accountId: string, ids: string[]) {
		const hashes = uniqueBuffers(ids.map(idToHash).filter((hash): hash is Buffer => hash !== undefined))
		if (hashes.length === 0) return []
		this.#ensureSource(database, accountId)
		const placeholders = hashes.map(() => '?').join(', ')
		return (
			database
				.prepare(
					`SELECT DISTINCT contents.blake3 FROM index_roots
					JOIN entries ON entries.root_id = index_roots.id
					JOIN contents ON contents.id = entries.content_id
					JOIN media_metadata ON media_metadata.content_id = entries.content_id AND media_metadata.state = 'ready'
					JOIN umbrel.photos_sources AS photos_source ON photos_source.account_id = index_roots.owner_id
						AND photos_source.type = 'umbrel'
					WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
						AND entries.type = 'file' AND entries.hidden = 0
						AND contents.blake3 IN (${placeholders}) AND ${sourceScopeSql('photos_source')}`,
				)
				.all(accountId, ...hashes) as Array<{blake3: Buffer}>
		).map(({blake3}) => blake3)
	}

	#withLiveCompanions(database: Database, accountId: string, hashes: Buffer[], includeUnavailable = false) {
		if (hashes.length === 0) return []
		const unique = uniqueBuffers(hashes)
		const placeholders = unique.map(() => '?').join(', ')
		const companions = database
			.prepare(
				`SELECT motion_hash FROM umbrel.photos_live_pairs WHERE account_id = ? AND still_hash IN (${placeholders})
				${
					includeUnavailable
						? ''
						: `AND EXISTS (SELECT 1 FROM entries
							JOIN index_roots ON index_roots.id = entries.root_id
							JOIN contents ON contents.id = entries.content_id
							WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
								AND contents.blake3 = umbrel.photos_live_pairs.motion_hash
								AND entries.type = 'file' AND entries.hidden = 0)`
				}`,
			)
			.all(accountId, ...unique, ...(includeUnavailable ? [] : [accountId])) as Array<{motion_hash: Buffer}>
		return uniqueBuffers([...unique, ...companions.map(({motion_hash}) => motion_hash)])
	}

	#refreshLivePairsTouchingContent(database: Database, accountId: string, contentId: number) {
		const metadata = database
			.prepare("SELECT kind FROM media_metadata WHERE content_id = ? AND state = 'ready'")
			.get(contentId) as {kind: 'photo' | 'video'} | undefined
		if (!metadata) return false
		if (metadata.kind === 'photo') return this.#refreshStillContent(database, accountId, contentId)
		const videos = this.#liveLocations(database, accountId, 'video')
		const changedVideo = videos.find((video) => video.content_id === contentId)
		if (!changedVideo) return false
		let changed = false
		const stillIds = new Set<number>()
		for (const still of this.#liveLocations(database, accountId, 'photo')) {
			if (!liveLocationsMatch(still, changedVideo)) continue
			stillIds.add(still.content_id)
		}
		for (const stillId of stillIds) changed = this.#refreshStillContent(database, accountId, stillId) || changed
		return changed
	}

	#refreshStillContent(database: Database, accountId: string, contentId: number) {
		const stillRows = this.#liveLocations(database, accountId, 'photo').filter((row) => row.content_id === contentId)
		if (stillRows.length === 0) return false
		const stillHash = stillRows[0]!.content_hash
		const previous = database
			.prepare('SELECT motion_hash FROM umbrel.photos_live_pairs WHERE account_id = ? AND still_hash = ?')
			.get(accountId, stillHash) as {motion_hash: Buffer} | undefined
		const candidate = bestLiveCandidate(stillRows, this.#liveLocations(database, accountId, 'video'))
		if (!candidate) {
			database
				.prepare(
					`DELETE FROM umbrel.photos_live_pairs AS pair WHERE account_id = ? AND still_hash = ? AND NOT (
						EXISTS (SELECT 1 FROM umbrel.photos_content_state AS still_state
							WHERE still_state.account_id = pair.account_id
								AND still_state.content_hash = pair.still_hash AND still_state.deleted_at IS NOT NULL)
						AND EXISTS (SELECT 1 FROM umbrel.photos_content_state AS motion_state
							WHERE motion_state.account_id = pair.account_id
								AND motion_state.content_hash = pair.motion_hash AND motion_state.deleted_at IS NOT NULL)
					)`,
				)
				.run(accountId, stillHash)
			return Boolean(previous)
		}
		database
			.prepare(
				`INSERT INTO umbrel.photos_live_pairs(account_id, still_hash, motion_hash, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(account_id, still_hash) DO UPDATE SET motion_hash = excluded.motion_hash,
					updated_at = excluded.updated_at`,
			)
			.run(accountId, stillHash, candidate.content_hash, Date.now())
		return !previous || !previous.motion_hash.equals(candidate.content_hash)
	}

	#liveLocations(database: Database, accountId: string, kind: 'photo' | 'video') {
		return database
			.prepare(
				`SELECT index_roots.owner_id AS account_id, contents.id AS content_id, contents.blake3 AS content_hash,
					index_roots.virtual_path AS root_virtual_path, entries.relative_path,
					media_metadata.kind, media_metadata.live_identifier, media_metadata.duration_ms
				FROM index_roots
				JOIN entries ON entries.root_id = index_roots.id
				JOIN contents ON contents.id = entries.content_id
				JOIN media_metadata ON media_metadata.content_id = entries.content_id AND media_metadata.state = 'ready'
				WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
					AND entries.type = 'file' AND entries.hidden = 0 AND media_metadata.kind = ?
				ORDER BY index_roots.virtual_path, entries.relative_path`,
			)
			.all(accountId, kind) as LivePairLocation[]
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
	const clauses = ['deleted_at IS ' + (filter.deleted ? 'NOT NULL' : 'NULL')]
	const parameters: unknown[] = []
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
				WHERE search_location.content_hash = logical_items.content_hash AND (
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
					AND (instr(search_location.search_name_folded, ?) > 0
						OR instr(search_location.search_text, ?) > 0))`,
			)
			const folded = foldSearchName(term)
			parameters.push(folded, folded)
		}
	}
	return {sql: clauses.join(' AND '), parameters}
}

function sourceScopeSql(source = 'umbrel.photos_sources', root = 'index_roots', entry = 'entries') {
	const virtualPath = `(${root}.virtual_path || '/' || ${entry}.relative_path)`
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

function idToHash(id: string): Buffer | undefined {
	return HASH_PATTERN.test(id) ? Buffer.from(id, 'hex') : undefined
}

function hashToId(hash: Buffer) {
	return hash.toString('hex')
}

function uniqueBuffers(values: Buffer[]) {
	return [...new Map(values.map((value) => [hashToId(value), value])).values()]
}

function livePathParts(relativePath: string) {
	const parent = nodePath.posix.dirname(relativePath)
	return {
		parent: parent === '.' ? '' : parent,
		stem: nodePath.posix.basename(relativePath, nodePath.posix.extname(relativePath)).toLocaleLowerCase(),
	}
}

function exactLiveIdentifierMatch(still: LivePairLocation, motion: LivePairLocation) {
	return Boolean(still.live_identifier && still.live_identifier === motion.live_identifier)
}

function liveLocationsMatch(still: LivePairLocation, motion: LivePairLocation) {
	if (exactLiveIdentifierMatch(still, motion)) return true
	if (motion.duration_ms === null || Number(motion.duration_ms) > 10_000) return false
	const stillPath = livePathParts(still.relative_path)
	const motionPath = livePathParts(motion.relative_path)
	return (
		still.root_virtual_path === motion.root_virtual_path &&
		stillPath.parent === motionPath.parent &&
		stillPath.stem === motionPath.stem
	)
}

function bestLiveCandidate(stills: LivePairLocation[], videos: LivePairLocation[]) {
	return videos
		.filter((video) => stills.some((still) => liveLocationsMatch(still, video)))
		.toSorted((left, right) => {
			const leftExact = Number(stills.some((still) => exactLiveIdentifierMatch(still, left)))
			const rightExact = Number(stills.some((still) => exactLiveIdentifierMatch(still, right)))
			return (
				rightExact - leftExact ||
				left.root_virtual_path.localeCompare(right.root_virtual_path) ||
				left.relative_path.localeCompare(right.relative_path) ||
				Buffer.compare(left.content_hash, right.content_hash)
			)
		})[0]
}

function samePairRows(
	left: Array<{still_hash: Buffer; motion_hash: Buffer}>,
	right: Array<{still_hash: Buffer; motion_hash: Buffer}>,
) {
	return (
		left.length === right.length &&
		left.every(
			(row, index) =>
				row.still_hash.equals(right[index]!.still_hash) && row.motion_hash.equals(right[index]!.motion_hash),
		)
	)
}

function ftsTrigramExpression(term: string) {
	const characters = Array.from(term)
	const trigrams = new Set<string>()
	for (let index = 0; index <= characters.length - 3; index++) {
		trigrams.add(characters.slice(index, index + 3).join(''))
	}
	return [...trigrams].map((value) => `"${value.replaceAll('"', '""')}"`).join(' AND ')
}
