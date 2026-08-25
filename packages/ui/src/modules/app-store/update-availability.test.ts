import {describe, expect, test} from 'vitest'

import type {RegistryApp} from '@/trpc/trpc'

import {canExecuteUpdate, canPresentUpdateAction, isAppUpdateAvailable} from './update-availability'

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

describe('canPresentUpdateAction()', () => {
	test.each(['ready', 'running', 'stopped', 'unknown'] as const)('allows the settled %s state', (state) => {
		expect(canPresentUpdateAction(state)).toBe(true)
	})

	test.each([
		'loading',
		'not-installed',
		'installing',
		'updating',
		'uninstalling',
		'starting',
		'restarting',
		'stopping',
	] as const)('rejects the unavailable %s state', (state) => {
		expect(canPresentUpdateAction(state)).toBe(false)
	})

	test.each([
		['owner', true],
		['member', false],
	] as const)('composes with %s authorization at the caller', (role, expected) => {
		expect(role === 'owner' && canPresentUpdateAction('stopped')).toBe(expected)
	})
})

describe('canExecuteUpdate()', () => {
	test('blocks incompatible apps in every settled state', () => {
		for (const state of ['ready', 'running', 'stopped', 'unknown'] as const) {
			expect(canExecuteUpdate(state, false)).toBe(false)
		}
	})

	test('allows a compatible settled app', () => {
		expect(canExecuteUpdate('stopped', true)).toBe(true)
	})
})
