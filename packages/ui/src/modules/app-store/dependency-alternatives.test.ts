import {describe, expect, test} from 'vitest'

import type {RegistryApp, UserApp} from '@/trpc/trpc'

import {getAppsImplementingDependency, getDependencyAlternatives} from './dependency-alternatives'

const registryApp = (id: string, overrides: Partial<RegistryApp> = {}) =>
	({id, appStoreId: 'umbrel-app-store', ...overrides}) as RegistryApp
const userApp = (id: string, overrides: Partial<UserApp> = {}) => ({id, ...overrides}) as UserApp

describe('dependency alternatives', () => {
	test('recovers an installed implementation after its community store is removed', () => {
		const installed = userApp('removed-postgres', {
			implements: ['postgres'],
		})
		const userAppsKeyed = {[installed.id]: installed}

		expect(getAppsImplementingDependency([], userAppsKeyed, 'postgres')).toEqual(['removed-postgres'])
		expect(getDependencyAlternatives(['postgres'], [], userAppsKeyed)).toEqual([
			{dependencyId: 'postgres', appIds: ['removed-postgres']},
		])
	})

	test('keeps only candidates with available or installed metadata', () => {
		const canonical = registryApp('postgres')
		expect(getDependencyAlternatives(['postgres'], [canonical], undefined)).toEqual([
			{dependencyId: 'postgres', appIds: ['postgres']},
		])
		expect(getDependencyAlternatives(['missing'], [], undefined)).toEqual([{dependencyId: 'missing', appIds: []}])
	})

	test('deduplicates a canonical app that also declares the implementation', () => {
		const canonical = registryApp('postgres', {implements: ['postgres']})
		expect(getDependencyAlternatives(['postgres'], [canonical], undefined)[0]?.appIds).toEqual(['postgres'])
	})

	test('does not resolve an ambiguous app from installed metadata', () => {
		const installed = userApp('conflicting-postgres', {implements: ['postgres']})
		const unavailableAppIds = new Set([installed.id])
		expect(
			getDependencyAlternatives(['conflicting-postgres'], [], {[installed.id]: installed}, unavailableAppIds),
		).toEqual([{dependencyId: 'conflicting-postgres', appIds: []}])
		expect(getAppsImplementingDependency([], {[installed.id]: installed}, 'postgres', unavailableAppIds)).toEqual([])
	})
})
