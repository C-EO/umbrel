---
name: umbreld-vm-test-authoring
description: Use this skill when adding, converting, or reviewing umbreld VM tests in the Umbrel repo. It describes the preferred style for clear VM tests that boot umbrelOS and exercise real OS, hardware, storage, networking, and reboot behavior.
---

# Umbrel VM Test Authoring

## Guidance

- Read other relevant VM tests when you need inspiration.
- Read `packages/umbreld/source/modules/test-utilities/create-test-umbreld.ts` to understand the VM test harness API before adding new helpers or guessing how VM lifecycle, auth clients, SSH, and device operations work.
- Use the `umbrel-home` machine by default because it is the simplest, unless the behavior specifically needs another machine type.
- Prefer testing real hardware/OS behavior: reboot, power cycle, attach devices, real networking, reflash to reset.
- Prefer public product surfaces: call tRPC/API methods, write files through the files API, configure things the way the product would.
- Avoid SSHing in and surgically modifying VM state where possible; use SSH only when there is no realistic product/API path or when asserting low-level OS facts.
- Use authenticated vs unauthenticated clients intentionally.
- Test private RPCs against the unauthenticated client when relevant, to confirm they are not publicly callable.
- Aim for high test coverage: think through edge cases, failure modes, persistence, and permissions, then make sure the important ones are covered by tests.
- If different cases need guaranteed fresh state, split them into separate VM tests/scenarios.
- If multiple checks share the same state, keep them in one VM scenario rather than booting new VMs unnecessarily.
- Since VM tests are stateful and expensive, it is fine for each `test()` to be one clear step in the overall scenario.
- Use clear `test()` names, and add short human-readable comments for each small step so the full test scenario can be easily skimmed and understood without having to read all the code.
- For actions with unpredictable timing, such as reboots, network changes, setup jobs, and hardware detection, use retry/wait helpers with sensible timeouts.
- Make hardware state explicit: device type, boot disk, slot numbers, disk sizes, transport.
- If a test needs simulated hardware the harness does not support yet, prefer adding a clean VM harness primitive over faking hardware state inside the guest.
- If you need functionality in the VM test harness that doesn't exist, you can add it. But only add it if it's general purpose and belongs there and will likely be needed again by other tests. If it's specific to this test, just inline it in the test file.

## Canonical Examples

### `packages/umbreld/source/modules/system/static-ip.vm.test.ts`

```ts
import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Static IP configuration', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let interfaceMac: string

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

	test('getNetworkInterfaces() returns the VM ethernet interface with DHCP', async () => {
		const interfaces = await umbreld.client.system.getNetworkInterfaces.query()

		// The VM has a single physical ethernet interface
		expect(interfaces).toHaveLength(1)
		const iface = interfaces[0]
		interfaceMac = iface.mac

		expect(iface.type).toBe('ethernet')
		expect(iface.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/)
		expect(iface.connected).toBe(true)
		expect(iface.ipMethod).toBe('dhcp')
		expect(iface.configuredStaticSettings).toBeUndefined()
		expect(iface.ip).toBeDefined()
		expect(iface.subnetPrefix).toBeTypeOf('number')
		expect(iface.gateway).toBeDefined()
		expect(iface.dns).toBeInstanceOf(Array)
		expect(iface.dns!.length).toBeGreaterThan(0)
	})

	test('switching to a static IP is reflected in getNetworkInterfaces()', async () => {
		const before = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!
		// Re-apply the same DHCP-assigned values as a static config so the IP
		// doesn't change, keeping QEMU port forwarding intact
		const {ip, subnetPrefix, gateway, dns} = before

		const setStaticIpPromise = umbreld.client.system.setStaticIp.mutate({
			mac: before.mac,
			ip: ip!,
			subnetPrefix: subnetPrefix!,
			gateway: gateway!,
			dns: dns!,
		})

		await new Promise((resolve) => setTimeout(resolve, 2000)) // Give the mutation a moment to trigger the network change

		// Wait for the connection to re-establish after down/up
		let after!: Awaited<ReturnType<typeof umbreld.client.system.getNetworkInterfaces.query>>[number]
		await pWaitFor(
			async () => {
				try {
					const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
					if (iface?.connected && iface.ip) {
						after = iface
						return true
					}
					return false
				} catch {
					return false
				}
			},
			{interval: 100, timeout: 5000},
		)

		// Settings should not be persisted until the client confirms the change worked
		expect(after.configuredStaticSettings).toBeUndefined()

		// Confirm the static IP change
		await umbreld.client.system.confirmStaticIp.mutate({ip: ip!})

		// Wait for the set job to resolve (it was waiting fro the confirmation)
		await setStaticIpPromise
		after = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!

		// Only the method should change, everything else stays the same
		expect(after.ipMethod).toBe('static')
		expect(after.configuredStaticSettings).toEqual({ip, subnetPrefix, gateway, dns})
		expect(after.ip).toBe(ip)
		expect(after.subnetPrefix).toBe(subnetPrefix)
		expect(after.gateway).toBe(gateway)
		expect(after.dns).toEqual(dns)
	})

	test('static IP settings persist after reboot', async () => {
		const before = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!

		// Power cycle the VM
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		// Retry until the interface comes back up with the static config intact
		await pRetry(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				expect(iface?.connected).toBe(true)
				expect(iface?.ipMethod).toBe('static')
				expect(iface?.configuredStaticSettings).toEqual({
					ip: before.ip!,
					subnetPrefix: before.subnetPrefix!,
					gateway: before.gateway!,
					dns: before.dns!,
				})
				expect(iface?.ip).toBe(before.ip)
				expect(iface?.subnetPrefix).toBe(before.subnetPrefix)
				expect(iface?.gateway).toBe(before.gateway)
				expect(iface?.dns).toEqual(before.dns)
			},
			{retries: 100, minTimeout: 100, maxTimeout: 100},
		)
	})

	test('clearStaticIp() reverts to DHCP', async () => {
		await umbreld.client.system.clearStaticIp.mutate({mac: interfaceMac})

		// Wait for the connection to re-establish on DHCP
		await pRetry(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				expect(iface?.connected).toBe(true)
				expect(iface?.ipMethod).toBe('dhcp')
				expect(iface?.configuredStaticSettings).toBeUndefined()
				expect(iface?.ip).toBeDefined()
				expect(iface?.gateway).toBeDefined()
				expect(iface?.dns).toBeInstanceOf(Array)
			},
			{retries: 50, minTimeout: 100, maxTimeout: 100},
		)
	})
})
```

### `packages/umbreld/source/modules/hardware/raid-storage.vm.test.ts`

```ts
import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID storage mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let initialTotalSpace: number
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

	test('adds NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('detects NVMe device in slot 1', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		expect(devices[0].slot).toBe(1)
		firstDeviceId = devices[0].id!
		expect(firstDeviceId).toBeDefined()
	})

	test('registers user with RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status after setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(firstDeviceId)
		initialTotalSpace = status.totalSpace!
		expect(initialTotalSpace).toBeGreaterThan(0)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	test('shuts down and adds second SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second SSD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects both NVMe devices after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const secondDevice = devices.find((d) => d.slot === 2)
		expect(secondDevice).toBeDefined()
		secondDeviceId = secondDevice!.id!
		expect(secondDeviceId).toBeDefined()
	})

	test('adds second SSD to RAID array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: secondDeviceId})
	})

	test('reports correct RAID status with both devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('has both devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('total space increased after adding second device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.totalSpace!).toBeGreaterThan(initialTotalSpace)
	})

	test('marker directory still exists after expansion', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})
```

### `packages/umbreld/source/modules/hardware/raid-failsafe.vm.test.ts`

```ts
import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {ExpansionStatus} from './raid.js'

describe('RAID failsafe mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let thirdDeviceId: string
	let initialUsableSpace: number
	let expansionSubscription: ReturnType<typeof umbreld.subscribeToEvents<ExpansionStatus>>
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

	test('adds two NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const device1 = devices.find((d) => d.slot === 1)
		const device2 = devices.find((d) => d.slot === 2)
		expect(device1).toBeDefined()
		expect(device2).toBeDefined()
		firstDeviceId = device1!.id!
		secondDeviceId = device2!.id!
	})

	test('registers user with failsafe RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'failsafe'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status after setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
	})

	test('has both devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('rejects addMirror endpoint on raidz failsafe arrays', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [firstDeviceId, secondDeviceId]}),
		).rejects.toThrow('addMirror is only supported for mirror failsafe mode')
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	test('shuts down and adds third SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 3})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding third SSD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects all three NVMe devices after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		const thirdDevice = devices.find((d) => d.slot === 3)
		expect(thirdDevice).toBeDefined()
		thirdDeviceId = thirdDevice!.id!
		expect(thirdDeviceId).toBeDefined()
	})

	test('adds third SSD to RAID array and subscribes to expansion events', async () => {
		// Subscribe to expansion events before adding the device
		expansionSubscription = umbreld.subscribeToEvents<ExpansionStatus>('raid:expansion-progress')

		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: thirdDeviceId})
	})

	test('reports correct RAID status with three devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(3)
	})

	test('has all three devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId, thirdDeviceId].sort())
	})

	// In RAIDZ1, when attaching a new device, the expansion is async.
	// Wait for expansion to complete and verify events only increase.
	test('receives expansion events via WebSocket', async () => {
		// Wait for expansion to complete via events
		await pWaitFor(
			() => {
				const events = expansionSubscription.collected
				const lastEvent = events[events.length - 1]
				return lastEvent?.state === 'finished' && lastEvent?.progress === 100
			},
			{interval: 1000, timeout: 30_000},
		)

		// Unsubscribe since expansion is complete
		expansionSubscription.unsubscribe()

		const events = expansionSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Verify events have correct structure
		for (const event of events) {
			expect(['expanding', 'finished', 'canceled']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across events
		const progressFromEvents = events.map((e) => e.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		// Verify we started below 100 and ended at 100
		expect(progressFromEvents[0]).toBeLessThan(100)
		expect(progressFromEvents[progressFromEvents.length - 1]).toBe(100)
	})

	test('usable space increased after expansion', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.usableSpace! > initialUsableSpace
			},
			{interval: 1000, timeout: 60_000},
		)
	})

	test('marker directory still exists after expansion', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})
```
