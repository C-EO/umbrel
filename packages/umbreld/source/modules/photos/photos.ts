import {randomBytes} from 'node:crypto'

import type Umbreld from '../../index.js'

import type {PhotoFilter, PhotoScopeMode} from './types.js'
import type {PublishedFileRevision} from '../files/file-index-enrichment.js'

export default class Photos {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#downloadTickets = new Map<string, {accountId: string; ids: string[]; expiresAt: number}>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('photos')
	}

	async start() {
		this.logger.log('Starting photos')
		await this.#umbreld.files.fileIndex.initializePhotos()
	}

	async stop() {}

	async createDownloadTicket(accountId: string, ids: string[]) {
		const uniqueIds = [...new Set(ids)]
		const resolved = await this.#umbreld.files.fileIndex.photosResolveItems(accountId, uniqueIds)
		if (resolved.length !== uniqueIds.length) throw new Error('[photos-item-not-found]')
		const now = Date.now()
		for (const [ticket, value] of this.#downloadTickets) {
			if (value.expiresAt <= now) this.#downloadTickets.delete(ticket)
		}
		const ticket = randomBytes(24).toString('base64url')
		this.#downloadTickets.set(ticket, {accountId, ids: uniqueIds, expiresAt: now + 60_000})
		return ticket
	}

	consumeDownloadTicket(accountId: string, ticket: string) {
		const value = this.#downloadTickets.get(ticket)
		if (!value || value.accountId !== accountId) return
		this.#downloadTickets.delete(ticket)
		if (value.expiresAt <= Date.now()) return
		return value.ids
	}

	summary(accountId: string) {
		return this.#umbreld.files.fileIndex.photosSummary(accountId)
	}

	indexingState(accountId: string) {
		return this.#umbreld.files.fileIndex.photosIndexingState(accountId)
	}

	listItems(accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		return this.#umbreld.files.fileIndex.photosListItems(accountId, filter, cursor, limit)
	}

	getItem(accountId: string, id: string) {
		return this.#umbreld.files.fileIndex.photosGetItem(accountId, id)
	}

	neighbors(accountId: string, id: string, filter: PhotoFilter) {
		return this.#umbreld.files.fileIndex.photosNeighbors(accountId, id, filter)
	}

	async setFavorite(accountId: string, ids: string[], favorite: boolean) {
		const changes = await this.#umbreld.files.fileIndex.photosSetFavorite(accountId, ids, favorite)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deleteItems(accountId: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosSetDeleted(accountId, ids, true)
		if (changes) this.#changed(accountId)
		return changes
	}

	async restoreItems(accountId: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosSetDeleted(accountId, ids, false)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deletePermanently(accountId: string, ids?: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveDeletedItems(accountId, ids)
		// A recovered claim can restore the visible file before enrichment has
		// reattached its content hash. Keep the durable Photos row until that brief
		// settling window closes so a retry cannot orphan and later reimport it.
		if (items.some(({pendingRevision}) => pendingRevision)) throw new Error('[photos-item-busy]')
		// Resolve the complete safe set before touching the filesystem, including
		// only Live companions no other deleted still references. Keep every
		// durable row until all moves succeed so a stopped/failed attempt can use
		// the preserved pair relation to resolve the same set on retry.
		for (const item of items) {
			// A prior attempt may already have moved this exact file. Only touch the
			// live pathname while the index still identifies the same content
			// revision. If a stopped attempt left an internal claim, restore it first
			// and keep the durable rows so the next retry can validate it normally.
			if (item.path && (await this.#umbreld.files.recoverTrashClaim(item.path, accountId))) {
				throw new Error('[trash-claim-recovered]')
			}
			if (item.path && item.revision && !item.recoverOnly) {
				await this.#umbreld.files.trash(item.path, accountId, item.revision)
			}
		}
		const changes = await this.#umbreld.files.fileIndex.photosDeleteItems(
			accountId,
			[...new Set(items.map(({id}) => id))],
			false,
		)
		if (changes) this.#changed(accountId)
		return changes
	}

	listAlbums(accountId: string) {
		return this.#umbreld.files.fileIndex.photosListAlbums(accountId)
	}

	async createAlbum(accountId: string, name: string, ids?: string[]) {
		const album = await this.#umbreld.files.fileIndex.photosCreateAlbum(accountId, name, ids)
		this.#changed(accountId)
		return album
	}

	async renameAlbum(accountId: string, id: string, name: string) {
		const changes = await this.#umbreld.files.fileIndex.photosRenameAlbum(accountId, id, name)
		if (changes) this.#changed(accountId)
		return changes
	}

	async setAlbumCover(accountId: string, id: string, itemId?: string) {
		const changes = await this.#umbreld.files.fileIndex.photosSetAlbumCover(accountId, id, itemId)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deleteAlbum(accountId: string, id: string) {
		const changes = await this.#umbreld.files.fileIndex.photosDeleteAlbum(accountId, id)
		if (changes) this.#changed(accountId)
		return changes
	}

	async addAlbumItems(accountId: string, id: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosAddAlbumItems(accountId, id, ids)
		if (changes) this.#changed(accountId)
		return changes
	}

	async removeAlbumItems(accountId: string, id: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosRemoveAlbumItems(accountId, id, ids)
		if (changes) this.#changed(accountId)
		return changes
	}

	listSources(accountId: string) {
		return this.#umbreld.files.fileIndex.photosListSources(accountId)
	}

	async updateSource(accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		const source = await this.#umbreld.files.fileIndex.photosUpdateSource(accountId, id, scope)
		if (source) {
			this.#changed(accountId)
			await this.#indexingProgress(accountId)
		}
		return source
	}

	async removeSource(accountId: string, id: string, keepItems: boolean) {
		const removed = await this.#umbreld.files.fileIndex.photosRemoveSource(accountId, id, keepItems)
		if (removed) {
			this.#changed(accountId)
			await this.#indexingProgress(accountId)
		}
		return removed
	}

	async resolveItem(accountId: string, id: string) {
		return (await this.#umbreld.files.fileIndex.photosResolveItems(accountId, [id]))[0]
	}

	resolveLiveCompanion(accountId: string, id: string) {
		return this.#umbreld.files.fileIndex.photosResolveLiveCompanion(accountId, id)
	}

	async prepareUpload(accountId: string, hash: Buffer, albumId?: string) {
		const result = await this.#umbreld.files.fileIndex.photosPrepareUpload(accountId, hash, albumId)
		if (result.status === 'duplicate') this.#changed(accountId)
		return result.status
	}

	async registerUpload(
		accountId: string,
		systemPath: string,
		hash: Buffer,
		revision: PublishedFileRevision,
		albumId?: string,
	) {
		const result = await this.#umbreld.files.fileIndex.photosRegisterUpload(
			accountId,
			systemPath,
			hash,
			revision,
			albumId,
		)
		this.#changed(accountId)
		return result.status
	}

	#changed(accountId: string) {
		this.#umbreld.eventBus.emit('photos:change', {accountIds: [accountId]})
	}

	async #indexingProgress(accountId: string) {
		try {
			const state = await this.indexingState(accountId)
			await this.#umbreld.eventBus.emit('photos:indexing-progress', {accountId, state})
		} catch (error) {
			// A progress notification is best-effort and must not turn a completed
			// source mutation into an API failure during file-index startup/recovery.
			this.logger.error('Failed to report Photos indexing progress', error)
		}
	}
}
