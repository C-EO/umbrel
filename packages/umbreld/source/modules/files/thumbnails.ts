import nodePath from 'node:path'

import fse from 'fs-extra'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'
import {
	parseThumbnailFilename,
	supportsThumbnail,
	thumbnailFilename,
	thumbnailSystemPath,
	THUMBNAIL_VARIANT,
} from './thumbnail-support.js'

type ThumbnailReference = {
	kind: 'content' | 'transient'
	key: string
	variant: typeof THUMBNAIL_VARIANT
	format: string
}

/**
 * Account-aware facade for thumbnails owned by the file-index worker.
 *
 * The worker owns content hashing, generation, deduplication, and cleanup so
 * those operations share one SQLite owner. This facade keeps authorization and
 * public URL construction in the Files module.
 */
export default class Thumbnails {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	thumbnailDirectory: string

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLowerCase()}`)
		this.thumbnailDirectory = nodePath.join(umbreld.dataDirectory, 'thumbnails')
	}

	async start() {
		this.logger.log('Starting thumbnails')
		await fse.ensureDir(this.thumbnailDirectory)
	}

	thumbnailUrl(reference: ThumbnailReference, systemPath: string) {
		const virtualPath = this.#umbreld.files.systemToVirtualPath(systemPath)
		return `/api/files/thumbnail/${thumbnailFilename(reference)}?path=${encodeURIComponent(virtualPath)}`
	}

	async getThumbnailOnDemand(virtualPath: string, userId: string = OWNER_USER_ID) {
		const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)
		const reference = await this.#umbreld.files.fileIndex.ensureThumbnail(systemPath)
		return this.thumbnailUrl(reference, systemPath)
	}

	async getExistingThumbnail(systemPath: string) {
		if (!supportsThumbnail(nodePath.basename(systemPath))) return
		const reference = await this.#umbreld.files.fileIndex.getExistingThumbnail(systemPath)
		return reference ? this.thumbnailUrl(reference, systemPath) : undefined
	}

	async resolveThumbnailRequest(filename: string, virtualPath: string, userId: string) {
		const requested = parseThumbnailFilename(filename)
		if (!requested) throw new Error('[thumbnail-not-found]')
		const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)
		if (
			!(await this.#umbreld.files.fileIndex.matchesThumbnail(
				systemPath,
				requested.kind,
				requested.key,
				requested.variant,
			))
		) {
			throw new Error('[thumbnail-not-found]')
		}
		const thumbnailPath = thumbnailSystemPath(this.thumbnailDirectory, requested)
		if (!(await fse.pathExists(thumbnailPath))) throw new Error('[thumbnail-not-found]')
		return thumbnailPath
	}

	async stop() {
		this.logger.log('Stopping thumbnails')
	}
}
