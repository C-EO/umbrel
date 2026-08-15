import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import Backups from './backups.js'

function createBackups() {
	const prepareBackup = vi.fn(async () => true)
	const releaseBackup = vi.fn(async () => {})
	const clearNotification = vi.fn(async () => {})
	const writeStore = vi.fn(async () => {})
	const emit = vi.fn()
	const backups = new Backups({
		dataDirectory: '/data',
		logger: {createChildLogger: () => ({log: vi.fn(), verbose: vi.fn(), error: vi.fn()})},
		files: {getBaseDirectory: (path: string) => `/data${path}`},
		machines: {prepareBackup, releaseBackup},
		notifications: {clear: clearNotification},
		store: {
			getWriteLock: async (callback: (store: {set: typeof writeStore}) => Promise<void>) => callback({set: writeStore}),
		},
		eventBus: {emit},
	} as unknown as Umbreld)

	vi.spyOn(backups, 'getRepository').mockResolvedValue({id: 'repository', path: '/External/Backup'} as never)
	vi.spyOn(backups, 'getRepositories').mockResolvedValue([{id: 'repository', path: '/External/Backup'}] as never)
	vi.spyOn(backups, 'repository').mockResolvedValue({stdout: '', stderr: '', exitCode: 0} as never)
	vi.spyOn(backups, 'createIgnoreFile').mockResolvedValue()
	vi.spyOn(backups, 'getRepositorySize').mockResolvedValue({used: 1, capacity: 2, available: 1})

	return {backups, prepareBackup, releaseBackup, clearNotification, writeStore, emit}
}

describe('machine snapshot backup lifecycle', () => {
	test('fails the backup instead of recording success when machine snapshot release fails', async () => {
		const {backups, releaseBackup, clearNotification, writeStore, emit} = createBackups()
		releaseBackup.mockRejectedValueOnce(new Error('[machine-backup-release-failed]'))

		await expect(backups.backup('repository')).rejects.toThrow('[machine-backup-release-failed]')

		expect(releaseBackup).toHaveBeenCalledOnce()
		expect(clearNotification).not.toHaveBeenCalled()
		expect(writeStore).not.toHaveBeenCalled()
		expect(backups.backupsInProgress).toEqual([])
		expect(emit).toHaveBeenLastCalledWith('backups:backup-progress', [])
	})

	test('does not release another backup when machine preparation itself is rejected', async () => {
		const {backups, prepareBackup, releaseBackup} = createBackups()
		prepareBackup.mockRejectedValueOnce(new Error('[machine-backup-already-running]'))

		await expect(backups.backup('repository')).rejects.toThrow('[machine-backup-already-running]')

		expect(releaseBackup).not.toHaveBeenCalled()
	})
})
