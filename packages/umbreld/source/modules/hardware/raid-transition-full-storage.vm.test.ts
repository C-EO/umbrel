import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID storage to failsafe transition with 90% full array', () => {
	// Small devices keep the ~90% fill and the transition's snapshot send down
	// to a couple of GB of I/O so the test doesn't saturate CI runners.
	const raidDeviceSize = '2G'

	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('adds one 2GB NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1, size: raidDeviceSize})
		await umbreld.vm.powerOn()
	})

	test('detects NVMe device', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		expect(devices[0].slot).toBe(1)
		firstDeviceId = devices[0].id!
		expect(firstDeviceId).toBeDefined()
	})

	test('registers user with storage RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
	})

	test('waits for VM to come back up and logs in', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('reports correct RAID status in storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
	})

	test('creates marker directory to verify data migration', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/migration-test-directory'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'migration-test-directory')).toBe(true)
	})

	test('fills array to over 90% capacity', async () => {
		const getUsage = async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()
			const usedSpace = status.usedSpace ?? 0
			const usableSpace = status.usableSpace ?? 1
			return {
				usedSpace,
				usableSpace,
				percent: (usedSpace / usableSpace) * 100,
			}
		}

		const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

		const sshFillCommand = async (command: string) => {
			for (let attempt = 1; ; attempt++) {
				try {
					await umbreld.vm.ssh(command)
					return
				} catch (error) {
					if (!String(error).includes('Connection lost before handshake') || attempt >= 6) throw error
					console.log(`SSH handshake failed before writing fill data; retrying (${attempt}/6)...`)
					await wait(1000)
				}
			}
		}

		const writeFillData = async (mbToWrite: number, mode: 'replace' | 'append') => {
			const redirect = mode === 'replace' ? '>' : '>>'
			await sshFillCommand(`
set -eu
bash -o pipefail -c 'dd if=/dev/zero bs=1M count=${mbToWrite} status=none | openssl enc -aes-256-ctr -K 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f -iv 000102030405060708090a0b0c0d0e0f ${redirect} ~/fill-data.bin'
sync
`)
		}

		const initialUsage = await getUsage()
		const initialUsedSpace = initialUsage.usedSpace
		const usableSpace = initialUsage.usableSpace
		const mb = 1024 * 1024

		// Start below the boundary, then append in coarse chunks. Tiny ZFS pools
		// update reported usage in uneven steps under CI load, so fine-grained
		// calibration can burn the whole test timeout without crossing 90%.
		//
		// The upper bound matters too: ZFS reserves slop space (a sizeable share
		// of a tiny pool), so overshooting much past 95% makes the transition's
		// snapshot/send fail with ENOSPC — a different failure mode than the
		// "transition a >90% full array" scenario this test exists to exercise.
		const minimumUsage = 90
		const maximumUsage = 95
		const appendTargetUsage = 0.91
		const replacementTargets = [0.88, 0.84, 0.8, 0.76, 0.72]

		console.log(`Current usage: ${initialUsage.percent.toFixed(1)}%`)

		// Write deterministic non-compressible data. This keeps the pool genuinely
		// full while avoiding slow /dev/urandom generation on loaded CI runners.
		let finalUsage = initialUsage
		let reachedSafeTarget = false
		for (const targetUsage of replacementTargets) {
			const bytesToWrite = Math.ceil(targetUsage * usableSpace - initialUsedSpace)
			const mbToWrite = Math.max(1, Math.ceil(bytesToWrite / mb))
			console.log(`Writing ${mbToWrite}MB to reach ~${targetUsage * 100}% capacity...`)
			await writeFillData(mbToWrite, 'replace')
			finalUsage = await getUsage()
			if (finalUsage.percent >= maximumUsage) {
				console.log(
					`Usage ${finalUsage.percent.toFixed(1)}% is above the snapshot-safe limit; retrying with a lower fill target...`,
				)
				continue
			}

			for (let i = 0; i < 12 && finalUsage.percent <= minimumUsage; i++) {
				const bytesToTarget = Math.ceil(appendTargetUsage * finalUsage.usableSpace - finalUsage.usedSpace)
				const remainingPercent = appendTargetUsage * 100 - finalUsage.percent
				const maxAppendChunkMb = remainingPercent > 4 ? 48 : remainingPercent > 2 ? 24 : 12
				const mbToAppend = Math.max(1, Math.min(maxAppendChunkMb, Math.ceil(bytesToTarget / mb)))

				console.log(`Usage ${finalUsage.percent.toFixed(1)}% is below target; appending ${mbToAppend}MB...`)
				await writeFillData(mbToAppend, 'append')
				finalUsage = await getUsage()

				if (finalUsage.percent >= maximumUsage) {
					console.log(
						`Usage ${finalUsage.percent.toFixed(1)}% exceeded the snapshot-safe limit; restarting from a lower fill target...`,
					)
					break
				}
			}

			if (finalUsage.percent > minimumUsage && finalUsage.percent < maximumUsage) {
				reachedSafeTarget = true
				break
			}
		}

		expect(reachedSafeTarget).toBe(true)
		expect(finalUsage.percent).toBeGreaterThan(minimumUsage)
		expect(finalUsage.percent).toBeLessThan(maximumUsage)
		console.log(`Final usage before transition: ${finalUsage.percent.toFixed(1)}%`)
	})

	test('shuts down and adds second 2GB NVMe device', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 2, size: raidDeviceSize})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second device', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const secondDevice = devices.find((d) => d.slot === 2)
		expect(secondDevice).toBeDefined()
		secondDeviceId = secondDevice!.id!
	})

	test('starts transition to failsafe mode', async () => {
		const result = await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: secondDeviceId})
		expect(result).toBe(true)
	})

	test('waits for VM to come back up after transition', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('waits for migration to complete (2 devices in array)', async () => {
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.devices?.length === 2) return true
				} catch {}
				if (status?.failsafeTransitionStatus?.state === 'error') {
					throw new Error(status.failsafeTransitionStatus.error)
				}
				return false
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.devices).toHaveLength(2)
	})

	test('reports correct RAID status in failsafe mode after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(['ONLINE', 'DEGRADED']).toContain(status.status)
		expect(status.devices).toHaveLength(2)
	})

	test('has both devices in the array after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('waits for transition to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus?.state === 'complete') return true
				if (!status.failsafeTransitionStatus && status.status === 'ONLINE') return true
				return false
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool eventually enters ONLINE state', async () => {
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.status).toBe('ONLINE')
	})

	test('verifies marker directory was migrated correctly', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'migration-test-directory')).toBe(true)
	})
})
