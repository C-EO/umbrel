import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe.sequential('Network storage lifecycle', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let mountPath: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	async function createLocalSambaShare(shareName: string) {
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}`})
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}/source-marker`})
		await umbreld.api.post(`files/upload?path=/Home/${shareName}/test-file.txt`, {body: 'test content'})
		await umbreld.client.files.addShare.mutate({path: `/Home/${shareName}`})
	}

	async function mountLocalSambaShare(shareName: string) {
		const sharePassword = await umbreld.client.files.sharePassword.query()

		return pRetry(
			() =>
				umbreld.client.files.addNetworkShare.mutate({
					host: 'localhost',
					share: `${shareName} (Umbrel)`,
					username: 'umbrel',
					password: sharePassword,
				}),
			{retries: 10, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	async function expectMountedShareToContain(name: string) {
		await pRetry(
			async () => {
				await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							mountPath,
							isMounted: true,
						}),
					]),
				)

				const listing = await umbreld.client.files.list.query({path: mountPath})
				expect(listing.files.map((file) => file.name)).toContain(name)
			},
			// The remount watcher retries every 60 seconds. Allow one missed
			// startup mount attempt when Samba is still coming up after reboot.
			{retries: 90, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	test('adds a CIFS share that later lifecycle checks can remount', async () => {
		const shareName = 'network-lifecycle-test'
		await createLocalSambaShare(shareName)

		mountPath = await mountLocalSambaShare(shareName)
		expect(mountPath).toBe(`/Network/localhost/${shareName} (Umbrel)`)
		await expectMountedShareToContain('source-marker')
	})

	test('auto-mounts configured network shares after a VM reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		await expectMountedShareToContain('source-marker')
		await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					mountPath,
					isMounted: true,
				}),
			]),
		)
	})

	test('unmounts CIFS shares when umbreld stops and remounts them on start', async () => {
		const cifsMountCount = async () =>
			Number((await umbreld.vm.ssh(`awk '$3 == "cifs" {count++} END {print count + 0}' /proc/mounts`)).trim())

		await pRetry(
			async () => {
				expect(await cifsMountCount()).toBeGreaterThan(0)
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		// The files API has no endpoint for stopping umbreld while leaving the VM running;
		// restarting the systemd service verifies the real shutdown/startup mount handlers.
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await pRetry(
			async () => {
				expect(await cifsMountCount()).toBe(0)
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		await umbreld.vm.sshAsRoot('systemctl start umbrel')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		await expectMountedShareToContain('source-marker')
	})

	test('recovers when the SMB server goes offline and then comes back', async () => {
		// There is no product API for simulating a network file server outage. Stopping
		// smbd keeps the client VM alive while exercising the real CIFS recovery path.
		await umbreld.vm.sshAsRoot('systemctl stop smbd')

		await pRetry(
			async () => {
				await expect(
					umbreld.client.files.createDirectory.mutate({path: `${mountPath}/during-outage`}),
				).rejects.toThrow()
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		await umbreld.vm.sshAsRoot('systemctl start smbd')

		// As above: the remount watcher only retries every 60 seconds, so allow a
		// full missed cycle before the share becomes writable again.
		await pRetry(() => umbreld.client.files.createDirectory.mutate({path: `${mountPath}/after-outage`}), {
			retries: 90,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
		await expectMountedShareToContain('after-outage')
	})
})
