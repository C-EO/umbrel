import nodePath from 'node:path'

import PQueue from 'p-queue'
import fse from 'fs-extra'
import {debounce} from 'es-toolkit'

import type Umbreld from '../../index.js'

import type {FileChangeEvent} from './watcher.js'
import {OWNER_USER_ID} from '../user/constants.js'

const NON_FILE_TYPES = new Set(['directory', 'symbolic-link', 'socket', 'block-device', 'character-device', 'fifo'])

export default class Recents {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#removeFileChangeListener?: () => void
	#activeWrite = Promise.resolve()
	// Debounce the write to disk to prevent excessive writes when many events are triggered
	#debouncedWrite = debounce(() => void this.#enqueueWrite(), 1000)
	#recentFiles = new Map<string, string[]>()
	#dirtyAccountIds = new Set<string>()
	#maxRecents = 50
	#queue = new PQueue({concurrency: 1})

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
	}

	// Add listener
	async start() {
		this.logger.log('Starting recents')

		// Read each account's recent files and set the owner's established store
		// entry on first run.
		// TODO: This should really be stored in a proper database.
		// Migrate this to SQLite once we have it. Or ideally query this
		// directly from a live filesystem index.
		const ownerRecents = await this.#umbreld.user.getAccountRecents(OWNER_USER_ID)
		this.#recentFiles.set(OWNER_USER_ID, ownerRecents ?? [])
		if (ownerRecents === undefined) {
			this.logger.log('Creating initial recents entry in store')
			await this.#umbreld.user.setAccountRecents(OWNER_USER_ID, [])
		}
		for (const member of await this.#umbreld.user.listMembers()) {
			this.#recentFiles.set(member.id, (await this.#umbreld.user.getAccountRecents(member.id)) ?? [])
		}

		// Attach listener
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)
	}

	// Get recents
	async get(userId: string = OWNER_USER_ID) {
		const recentFiles = await this.#recentFilesFor(userId)
		const recents = await Promise.all(
			recentFiles.map(async (virtualPath) => {
				const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)
				return this.#umbreld.files.status(systemPath, userId).catch(() => undefined)
			}),
		)

		// Filter out paths that no longer exist or are no longer files.
		const filteredRecents = recents.filter(
			(file): file is NonNullable<typeof file> => file != null && !NON_FILE_TYPES.has(file.type),
		)

		return filteredRecents
	}

	// Write recents
	#enqueueWrite() {
		this.#activeWrite = this.#activeWrite
			.then(() => this.#directWrite())
			.catch((error) => this.logger.error('Failed to flush recents', error))
		return this.#activeWrite
	}

	async #directWrite() {
		const dirtyAccountIds = [...this.#dirtyAccountIds]
		for (const userId of dirtyAccountIds) this.#dirtyAccountIds.delete(userId)

		for (const userId of dirtyAccountIds) {
			const recentFiles = this.#recentFiles.get(userId)
			if (!recentFiles) continue
			try {
				await this.#umbreld.user.setAccountRecents(userId, recentFiles)
			} catch (error) {
				// Member deletion removes its durable record before watcher teardown.
				// Drop any queued state instead of recreating the deleted account.
				let deletedMember = false
				if (userId !== OWNER_USER_ID) {
					try {
						deletedMember = !(await this.#umbreld.user.getMember(userId))
					} catch (lookupError) {
						this.logger.error(`Failed to check whether ${userId} was deleted`, lookupError)
					}
				}
				if (deletedMember) {
					this.#recentFiles.delete(userId)
					continue
				}
				this.#dirtyAccountIds.add(userId)
				this.#debouncedWrite()
				this.logger.error(`Failed to save recents for ${userId}`, error)
			}
		}
	}

	#setRecentFiles(userId: string, recentFiles: string[]) {
		this.#recentFiles.set(userId, recentFiles)
		this.#dirtyAccountIds.add(userId)
		this.#debouncedWrite()
	}

	async #recentFilesFor(userId: string) {
		const existing = this.#recentFiles.get(userId)
		if (existing) return existing
		const recentFiles = (await this.#umbreld.user.getAccountRecents(userId)) ?? []
		const populatedWhileReading = this.#recentFiles.get(userId)
		if (populatedWhileReading) return populatedWhileReading
		this.#recentFiles.set(userId, recentFiles)
		return recentFiles
	}

	// Handle file change
	async #handleFileChange(event: FileChangeEvent) {
		// Pipe through a queue to ensure we handle events in order
		return this.#queue
			.add(async () => {
				// Calculate paths
				const systemPath = event.path
				const path = this.#umbreld.files.systemToVirtualPath(systemPath)
				const userId = this.#umbreld.files.ownerOfPath(path)

				// Track only the owning account's Home, never Trash or another
				// account's shared activity.
				const home = userId === OWNER_USER_ID ? '/Home' : `/Users/${userId}`
				const trash = this.#umbreld.files.trashRootForUser(userId)
				if (!path.startsWith(`${home}/`) || path === trash || path.startsWith(`${trash}/`)) return

				// Ignore hidden files
				if (this.#umbreld.files.isHidden(nodePath.basename(path))) return

				// Ignore files in the backups directory
				if (path.includes(`/${this.#umbreld.backups.backupDirectoryName}/`)) return

				// Remove the path from the list if it exists
				// This is to prevent duplicates when adding or to remove with a deletion
				const currentRecentFiles = await this.#recentFilesFor(userId)
				let recentFiles = currentRecentFiles.filter((item) => item !== path)
				const removedExistingEntry = recentFiles.length !== currentRecentFiles.length

				// Add the path back to the beginning of the list if it's an update or create
				if (['update', 'create'].includes(event.type)) {
					// Check file is not a directory or non standard file type
					const stats = await fse.lstat(systemPath).catch(() => undefined)
					if (!stats?.isFile()) {
						if (removedExistingEntry) this.#setRecentFiles(userId, recentFiles)
						return
					}

					recentFiles.unshift(path)
				} else if (!removedExistingEntry) {
					return
				}

				// Keep the list at maxRecents length
				this.#setRecentFiles(userId, recentFiles.slice(0, this.#maxRecents))
			})
			.catch((error) => this.logger.error(`Failed to handle file change`, error))
	}

	// Remove listener
	async stop() {
		this.logger.log('Stopping recents')
		this.#removeFileChangeListener?.()
		await this.#queue.onIdle()
		this.#debouncedWrite.cancel()
		await this.#enqueueWrite()
		this.#debouncedWrite.cancel()
	}
}
