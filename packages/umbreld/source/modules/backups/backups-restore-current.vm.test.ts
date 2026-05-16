import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {RestoreStatus} from './backups.js'
import {
	bootWithExternalStorage,
	expectRestoreProgressEvents,
	externalPath,
	latestBackup,
	repositoryPassword,
	restoreBackupAndWait,
	waitForBackupsKopiaReady,
	waitForExternalStorage,
} from './backups.vm-test-helpers.js'

describe.sequential('Backup restore on current install', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let repositoryId: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await bootWithExternalStorage(umbreld)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('creates a restorable backup on external storage', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/current-restore-marker'})
		repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: externalPath,
			password: repositoryPassword,
		})
		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)
	})

	test('restores a backup on the current Umbrel install', async () => {
		const backup = await latestBackup(umbreld, repositoryId)
		const restoreProgressSubscription = umbreld.subscribeToEvents<RestoreStatus>('backups:restore-progress')
		await restoreProgressSubscription.started

		await umbreld.client.files.trash.mutate({path: '/Home/current-restore-marker'})
		await restoreBackupAndWait({umbreld, backupId: backup.id})

		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain('current-restore-marker')
		// A real VM restore reboots into a fresh umbreld process, so the
		// in-memory restoreStatus resets while completion is covered by events.
		await expect(umbreld.client.backups.restoreStatus.query()).resolves.toMatchObject({
			running: false,
			error: false,
		})
		expectRestoreProgressEvents(restoreProgressSubscription.collected, backup.id)
		restoreProgressSubscription.unsubscribe()

		await waitForExternalStorage(umbreld)
		await waitForBackupsKopiaReady(umbreld)
	})
})
