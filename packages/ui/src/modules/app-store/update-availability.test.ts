import {describe, expect, test} from 'vitest'

import type {RegistryApp} from '@/trpc/trpc'

import {isAppUpdateAvailable} from './update-availability'

const availableApp = (overrides: Partial<RegistryApp> = {}) =>
	({version: '2.0.0', compatible: true, ...overrides}) as RegistryApp

describe('isAppUpdateAvailable()', () => {
	test('reports version changes', () => {
		expect(isAppUpdateAvailable('1.0.0', availableApp())).toBe(true)
	})

	test('reports incompatible version changes so the required OS update can be shown', () => {
		expect(isAppUpdateAvailable('1.0.0', availableApp({compatible: false}))).toBe(true)
	})

	test('does not report unchanged or missing apps', () => {
		expect(isAppUpdateAvailable('2.0.0', availableApp())).toBe(false)
		expect(isAppUpdateAvailable('1.0.0')).toBe(false)
	})
})
