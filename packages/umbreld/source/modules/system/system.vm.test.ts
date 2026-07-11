import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

describe('cpuTemperature', () => {
	// QEMU exposes no thermal sensors so the VM deterministically exercises the
	// unsupported branch (on real hardware this returns a number).
	test('should throw error if cpu temp is unsupported', async () => {
		await expect(umbreld.client.system.cpuTemperature.query()).rejects.toThrow('Could not get CPU temperature')
	})

	test('should be behind authentication', async () => {
		await expect(umbreld.unauthenticatedClient.system.cpuTemperature.query()).rejects.toThrow('Invalid token')
	})
})

describe('diskUsage', () => {
	test('should return disk usage', async () => {
		const result = await umbreld.client.system.diskUsage.query()
		expect(result.size).toBeTypeOf('number')
		expect(result.totalUsed).toBeTypeOf('number')
		expect(result.files).toBeTypeOf('number')
	})

	test('should be behind authentication', async () => {
		await expect(umbreld.unauthenticatedClient.system.diskUsage.query()).rejects.toThrow('Invalid token')
	})
})

describe('memoryUsage', () => {
	test('should return memory usage', async () => {
		const result = await umbreld.client.system.memoryUsage.query()
		expect(result.size).toBeTypeOf('number')
		expect(result.totalUsed).toBeTypeOf('number')
	})

	test('should be behind authentication', async () => {
		await expect(umbreld.unauthenticatedClient.system.memoryUsage.query()).rejects.toThrow('Invalid token')
	})
})
