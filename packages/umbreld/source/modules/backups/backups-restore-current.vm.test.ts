import nodePath from 'node:path'
import {setTimeout} from 'node:timers/promises'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import fse from 'fs-extra'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import {CLOUD_SCHEDULER_INTERVAL} from '../files/cloud.js'
import {
	startVmCloudWebDav,
	waitForSync,
	VM_CLOUD_WEBDAV_PASSWORD,
	VM_CLOUD_WEBDAV_URL,
	VM_CLOUD_WEBDAV_USERNAME,
	writeVmCloudFixture,
} from '../files/cloud.vm-test-helpers.js'
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
	let machineId: string
	let cloudAccountId: string
	let syncId: string
	let cloudLastSuccessfulAt: number
	let restoredMcpToken: string
	let restoredPhotoId: string
	let restoredPhotoAlbumId: string
	const cloudDestination = '/Home/current-restore-cloud'
	const restoredMcpPermissions = {
		apps: [] as string[],
		appStore: false,
		files: [] as string[],
		manageSystem: false,
	}

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
		await umbreld.api.post('files/upload?path=/Home/backup-machine.img', {body: Buffer.alloc(1024 * 1024)})
		const machine = await umbreld.client.machines.create.mutate({
			name: 'Backup restore machine',
			imagePath: '/Home/backup-machine.img',
			arch: 'amd64',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		machineId = machine.id
		await umbreld.client.machines.updateSettings.mutate({id: machineId, autostart: true})

		await writeVmCloudFixture(umbreld, '/source/before-restore.txt', 'present in the backup')
		await startVmCloudWebDav(umbreld)
		const connected = await umbreld.client.files.cloud.connectWebDav.mutate({
			flavor: 'webdav',
			url: VM_CLOUD_WEBDAV_URL,
			username: VM_CLOUD_WEBDAV_USERNAME,
			password: VM_CLOUD_WEBDAV_PASSWORD,
			tlsMode: 'default',
		})
		cloudAccountId = connected.account.id
		await umbreld.client.files.createDirectory.mutate({path: cloudDestination})
		const created = await umbreld.client.files.cloud.create.mutate({
			accountId: cloudAccountId,
			remote: {path: '/source'},
			destination: {path: cloudDestination},
			mode: 'auto',
		})
		syncId = created.id
		const completed = await waitForSync(umbreld.client, syncId, (cloud) => cloud.lastSuccessfulAt !== undefined, {
			timeout: 120_000,
		})
		cloudLastSuccessfulAt = completed.lastSuccessfulAt!
		const mcpCredential = await umbreld.client.mcp.enable.mutate({
			label: 'Backup restore test',
			agentType: 'generic',
		})
		if (!mcpCredential) throw new Error('Initial MCP enable did not issue a credential')
		restoredMcpToken = mcpCredential.token
		await umbreld.client.mcp.setPermissions.mutate(restoredMcpPermissions)

		const photo = await fse.readFile(
			nodePath.resolve(__dirname, '../files/fixtures/thumbnails/master-lossless-image.png'),
		)
		await expect(
			umbreld.api.post('photos/upload?name=backup-state.png', {body: photo, responseType: 'json'}),
		).resolves.toMatchObject({body: {status: 'imported'}})
		await pRetry(
			async () => expect(await umbreld.client.photos.library.status.query()).toMatchObject({phase: 'ready'}),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		const photoPage = await umbreld.client.photos.items.list.query({filter: {query: 'backup-state'}, limit: 10})
		restoredPhotoId = photoPage.items[0]!.id
		await umbreld.client.photos.items.setFavorite.mutate({ids: [restoredPhotoId], favorite: true})
		const photoAlbum = await umbreld.client.photos.albums.create.mutate({
			name: 'Restored album',
			ids: [restoredPhotoId],
		})
		restoredPhotoAlbumId = photoAlbum.id
		await umbreld.client.photos.items.delete.mutate({ids: [restoredPhotoId]})

		repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: externalPath,
			password: repositoryPassword,
		})
		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)
		const snapshot = await latestBackup(umbreld, repositoryId)
		const backupFiles = await umbreld.client.backups.listBackupFiles.query({backupId: snapshot.id})
		expect(backupFiles).toContain('umbrel.db')
		expect(backupFiles).toContain('umbrel.db-wal')
		expect(backupFiles).toContain('umbrel.db-shm')
		expect(backupFiles).not.toContain('file-index')
		expect(backupFiles).not.toContain('thumbnails')

		// Diverge durable Photos state after the snapshot so restore must recover it.
		await umbreld.client.photos.items.restore.mutate({ids: [restoredPhotoId]})
		await umbreld.client.photos.items.setFavorite.mutate({ids: [restoredPhotoId], favorite: false})
		await umbreld.client.photos.albums.delete.mutate({id: restoredPhotoAlbumId})

		const runningMachine = (await umbreld.client.machines.list.query()).find(({id}) => id === machineId)
		expect(runningMachine?.state).toBe('running')
		const liveXml = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system dumpxml umbrel-machine-${machineId}`)
		expect(liveXml).toContain(`/run/umbrel-machines/${machineId}/storage/disk.qcow2`)
		expect(liveXml).not.toContain('backup-overlay.qcow2')

		const backup = await latestBackup(umbreld, repositoryId)
		const machineFiles = await umbreld.client.backups.listBackupFiles.query({
			backupId: backup.id,
			path: `/machines/${machineId}`,
		})
		expect(machineFiles).toEqual(expect.arrayContaining(['machine.yaml', 'disk.qcow2', 'nvram.fd']))
		expect(machineFiles).not.toContain('operations')
	})

	test('restores a backup on the current Umbrel install', async () => {
		const backup = await latestBackup(umbreld, repositoryId)
		const restoreProgressSubscription = umbreld.subscribeToEvents<RestoreStatus>('backups:restore-progress')
		await restoreProgressSubscription.started

		await writeVmCloudFixture(umbreld, '/source/after-restore.txt', 'created after the backup')
		await umbreld.client.files.trash.mutate({path: '/Home/current-restore-marker'})
		await umbreld.client.machines.uninstall.mutate({id: machineId})
		await expect(umbreld.client.machines.list.query()).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({id: machineId})]),
		)
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

		await pRetry(
			async () => {
				const machine = (await umbreld.client.machines.list.query()).find(({id}) => id === machineId)
				expect(machine).toMatchObject({
					id: machineId,
					name: 'Backup restore machine',
					autostart: true,
					state: 'running',
				})
			},
			{retries: 120, factor: 1, minTimeout: 500, maxTimeout: 500},
		)
		const restoredDomain = await umbreld.vm.sshAsRoot(
			`virsh --connect qemu:///system dominfo umbrel-machine-${machineId}`,
		)
		expect(restoredDomain).toContain('Persistent:     no')
		await expect(
			umbreld.vm.sshAsRoot(`test -f /home/umbrel/umbrel/machines/${machineId}/disk.qcow2 && echo restored`),
		).resolves.toBe('restored')

		await pRetry(
			async () => expect(await umbreld.client.photos.library.status.query()).toMatchObject({phase: 'ready'}),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		await expect(
			umbreld.client.photos.items.list.query({filter: {deleted: true, query: 'backup-state'}, limit: 10}),
		).resolves.toMatchObject({
			total: 1,
			items: [expect.objectContaining({id: restoredPhotoId, isFavorite: true})],
		})
		await expect(umbreld.client.photos.albums.list.query()).resolves.toContainEqual(
			expect.objectContaining({id: restoredPhotoAlbumId, name: 'Restored album'}),
		)
		await umbreld.client.photos.items.restore.mutate({ids: [restoredPhotoId]})
		await expect(umbreld.client.photos.albums.list.query()).resolves.toContainEqual(
			expect.objectContaining({id: restoredPhotoAlbumId, count: 1, coverId: restoredPhotoId}),
		)

		const restoredCloud = await waitForSync(
			umbreld.client,
			syncId,
			(cloud) => cloud.pauseReasons?.restore === true && cloud.status.state === 'paused',
			{timeout: 120_000},
		)
		expect(restoredCloud).toMatchObject({
			accountId: cloudAccountId,
			pauseReasons: {restore: true},
			status: {state: 'paused'},
		})
		expect(await umbreld.client.files.cloud.accounts.query()).toEqual([
			expect.objectContaining({id: cloudAccountId, provider: 'webdav'}),
		])
		expect((await umbreld.client.files.list.query({path: cloudDestination})).files.map(({name}) => name)).toEqual([
			'before-restore.txt',
		])

		await startVmCloudWebDav(umbreld)
		const remoteListing = await umbreld.client.files.cloud.browse.query({
			accountId: cloudAccountId,
			remote: {path: '/source'},
		})
		expect(remoteListing.entries.map(({name}) => name).sort()).toEqual(['after-restore.txt', 'before-restore.txt'])
		expect(remoteListing.truncated).toBe(false)

		// Observe a complete scheduler interval so this proves the restored sync
		// stays paused rather than merely checking before its first tick.
		await setTimeout(CLOUD_SCHEDULER_INTERVAL + 2_000)
		expect(await umbreld.client.files.cloud.activity.query()).toEqual([])
		expect((await umbreld.client.files.cloud.syncs.query()).find(({id}) => id === syncId)).toMatchObject({
			lastSuccessfulAt: cloudLastSuccessfulAt,
			pauseReasons: {restore: true},
			status: {state: 'paused'},
		})
		expect((await umbreld.client.files.list.query({path: cloudDestination})).files.map(({name}) => name)).toEqual([
			'before-restore.txt',
		])

		await umbreld.client.files.cloud.resume.mutate({syncId: syncId})
		await waitForSync(umbreld.client, syncId, (cloud) => (cloud.lastSuccessfulAt ?? 0) > cloudLastSuccessfulAt, {
			timeout: 120_000,
		})
		expect(
			(await umbreld.client.files.list.query({path: cloudDestination})).files.map(({name}) => name).sort(),
		).toEqual(['after-restore.txt', 'before-restore.txt'])

		await waitForExternalStorage(umbreld)
		await waitForBackupsKopiaReady(umbreld)
	})

	test('resets MCP and rejects the token restored from backup', async () => {
		await expect(umbreld.client.mcp.getSettings.query()).resolves.toMatchObject({
			enabled: false,
			permissions: restoredMcpPermissions,
		})
		await expect(umbreld.client.mcp.listTokens.query()).resolves.toStrictEqual([])

		const endpoint = new URL(`http://127.0.0.1:${umbreld.vm.httpPort}/mcp`)
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {authorization: `Bearer ${restoredMcpToken}`},
		})
		expect(response.status).toBe(401)
	})
})
