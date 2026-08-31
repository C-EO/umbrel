import {randomBytes} from 'node:crypto'
import nodePath from 'node:path'

import fse from 'fs-extra'

import type Umbreld from '../../index.js'

import type {PhotoFilter, PhotoScopeMode} from './types.js'
import type {PublishedFileRevision} from '../files/file-index-enrichment.js'

export type PhotoBackupSource = {
	id: string
	accountId: string
	name: string
	createdAt: number
}

export type PhotoBackupResourceDescriptor = {
	resourceKey: string
	fileExtension: string
}

export type PhotoBackupResourceReceipt = {
	resourceKey: string
	path: string
	bytes: number
}

export const PHOTO_BACKUP_SOURCE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const PHOTO_RESOURCE_KEY_PATTERN = /^[0-9a-f]{64}$/
export const PHOTO_FILE_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const normalizeBackupSourceId = (sourceId: string) => {
	const normalized = sourceId.toLowerCase()
	if (!PHOTO_BACKUP_SOURCE_ID_PATTERN.test(normalized)) throw new Error('Invalid photo backup source id')
	return normalized
}

const normalizeBackupSourceName = (sourceName: string) => {
	const normalized = sourceName.trim()
	if (!normalized || normalized.length > 100 || CONTROL_CHARACTER_PATTERN.test(normalized)) {
		throw new Error('Invalid photo backup source name')
	}
	return normalized
}

const validateAccountId = (accountId: string) => {
	// Account ids are server-issued, but keep the storage boundary safe without
	// duplicating the User module's naming policy.
	if (
		!accountId ||
		accountId === '.' ||
		accountId === '..' ||
		CONTROL_CHARACTER_PATTERN.test(accountId) ||
		nodePath.basename(accountId) !== accountId
	) {
		throw new Error('Invalid Photos account id')
	}
	return accountId
}

export default class Photos {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#downloadTickets = new Map<string, {accountId: string; ids: string[]; expiresAt: number}>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('photos')
	}

	get mediaDirectory() {
		return nodePath.join(this.#umbreld.dataDirectory, 'photos', 'media')
	}

	async start() {
		this.logger.log('Starting photos')
		await this.#umbreld.files.fileIndex.initializePhotos()
	}

	async stop() {}

	async registerBackupSource({
		accountId,
		sourceId,
		suggestedName,
	}: {
		accountId: string
		sourceId: string
		suggestedName: string
	}): Promise<PhotoBackupSource> {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const name = normalizeBackupSourceName(suggestedName)
		let source: PhotoBackupSource = {id: sourceId, accountId, name, createdAt: Date.now()}

		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const existing = sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
			if (existing) {
				source = existing
				return
			}
			await set('photos.backupSources', [...sources, source])
		})

		// The store owns backup source identity. Its media directory is derived and
		// can be recreated after an interrupted registration or missing disk state.
		await fse.ensureDir(this.backupSourceMediaDirectory(source), {mode: 0o700})
		return source
	}

	async deleteAccount(accountId: string) {
		accountId = validateAccountId(accountId)

		// Remove media before its ownership records. If either step fails, account
		// deletion remains pending and safely retries this idempotent sequence.
		await fse.remove(this.#accountMediaDirectory(accountId))
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const remaining = sources.filter((source) => source.accountId !== accountId)
			if (remaining.length !== sources.length) await set('photos.backupSources', remaining)
		})
	}

	async confirmedBackupResources({
		accountId,
		sourceId,
		resources,
	}: {
		accountId: string
		sourceId: string
		resources: PhotoBackupResourceDescriptor[]
	}): Promise<PhotoBackupResourceReceipt[]> {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const unique = new Map<string, PhotoBackupResourceDescriptor>()
		for (const resource of resources) {
			const resourceKey = resource.resourceKey.toLowerCase()
			const fileExtension = resource.fileExtension.toLowerCase()
			if (!PHOTO_RESOURCE_KEY_PATTERN.test(resourceKey) || !PHOTO_FILE_EXTENSION_PATTERN.test(fileExtension)) {
				throw new Error('Invalid photo backup resource')
			}
			unique.set(`${resourceKey}.${fileExtension}`, {resourceKey, fileExtension})
		}
		const sources = (await this.#umbreld.store.get('photos.backupSources')) ?? []
		const source = sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
		if (!source) return []

		// A regular file at the derived final path is the durable receipt: it only
		// appears after the upload body has been atomically promoted.
		const directory = this.backupSourceMediaDirectory(source)
		const receipts = await Promise.all(
			[...unique.values()].map(async ({resourceKey, fileExtension}) => {
				const fileName = `${resourceKey}.${fileExtension}`
				try {
					const stats = await fse.lstat(nodePath.join(directory, fileName))
					if (!stats.isFile()) return undefined
					return {resourceKey, path: `${source.id}/${fileName}`, bytes: stats.size}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
					throw error
				}
			}),
		)
		return receipts.filter((receipt): receipt is PhotoBackupResourceReceipt => receipt !== undefined)
	}

	backupSourceMediaDirectory(source: Pick<PhotoBackupSource, 'accountId' | 'id'>) {
		return nodePath.join(this.#accountMediaDirectory(source.accountId), normalizeBackupSourceId(source.id))
	}

	#accountMediaDirectory(accountId: string) {
		return nodePath.join(this.mediaDirectory, validateAccountId(accountId))
	}

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

	getItem(accountId: string, id: string, deleted = false) {
		return this.#umbreld.files.fileIndex.photosGetItem(accountId, id, deleted)
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
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'home')
		for (const item of items) await this.#umbreld.files.trash(item.path, accountId, item.revision)
		if (items.length) this.#changed(accountId)
		return items.length
	}

	async restoreItems(accountId: string, ids: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'trash')
		for (const item of items) await this.#umbreld.files.restore(item.path, {userId: accountId, waitForIndex: true})
		if (items.length) this.#changed(accountId)
		return items.length
	}

	async deletePermanently(accountId: string, ids?: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'trash')
		if (items.length === 0) return 0
		const paths = [...new Set(items.map(({path}) => path))]
		const expectedRevisions = new Map(items.map(({path, revision}) => [path, revision]))
		const results = await this.#umbreld.files.deleteMany(paths, accountId, {waitForIndex: true, expectedRevisions})
		if (results.some((deleted) => !deleted)) throw new Error('[photos-delete-failed]')
		this.#changed(accountId)
		return results.length
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
