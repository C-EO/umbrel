// @vitest-environment jsdom

import {act, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, test, vi} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {
	areCustomEnvironmentVariablesEqual,
	areEnvironmentVariablesEqual,
	EnvironmentVariablesSettings,
	getCustomEnvironmentVariables,
	getEnvironmentVariableCount,
	getEnvironmentVariables,
	type AppCustomEnvironmentVariable,
	type AppEnvironmentVariable,
} from './app-settings-environment'

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({
		t: (key: string) =>
			key === 'app-settings.environment.app-default'
				? 'App default'
				: key === 'app-settings.environment.default'
					? 'Default'
					: key,
	}),
}))
vi.stubGlobal(
	'ResizeObserver',
	class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const app = {
	environment: {
		exposed: [
			{
				name: 'PUID',
				services: ['server', 'worker'],
				default: '1000',
				note: 'User ID',
				value: '2000',
			},
		],
		custom: [{serviceName: 'worker', name: 'DEBUG', value: 'true'}],
		services: ['server', 'worker'],
		serviceImages: {},
	},
} as UserApp

describe('environment variable settings', () => {
	let container: HTMLDivElement | undefined
	let root: ReturnType<typeof createRoot> | undefined

	afterEach(() => {
		if (root) act(() => root?.unmount())
		container?.remove()
		container = undefined
		root = undefined
	})

	const renderSettings = (app: UserApp) => {
		function Settings() {
			const [variables, setVariables] = useState(() => getEnvironmentVariables(app))
			const [customVariables, setCustomVariables] = useState(() => getCustomEnvironmentVariables(app))
			return (
				<EnvironmentVariablesSettings
					app={app}
					variables={variables}
					setVariables={setVariables}
					customVariables={customVariables}
					setCustomVariables={setCustomVariables}
				/>
			)
		}

		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		act(() => root?.render(<Settings />))
		return container
	}

	test('keeps manifest and custom variables as separate user intents', () => {
		expect(getEnvironmentVariables(app)).toStrictEqual([{name: 'PUID', value: '2000'}])
		expect(getCustomEnvironmentVariables(app)).toStrictEqual([{serviceName: 'worker', name: 'DEBUG', value: 'true'}])
	})

	test('compares manifest variables by name and custom variables by service and name', () => {
		const puid: AppEnvironmentVariable = {name: 'PUID', value: '2000'}
		const pgid: AppEnvironmentVariable = {name: 'PGID', value: '2000'}
		const server: AppCustomEnvironmentVariable = {serviceName: 'server', name: 'DEBUG', value: 'true'}
		const worker: AppCustomEnvironmentVariable = {serviceName: 'worker', name: 'DEBUG', value: 'true'}

		expect(areEnvironmentVariablesEqual([puid, pgid], [pgid, puid])).toBe(true)
		expect(areCustomEnvironmentVariablesEqual([server, worker], [worker, server])).toBe(true)
		expect(areCustomEnvironmentVariablesEqual([server], [worker])).toBe(false)
	})

	test('counts a manifest setting once when it targets multiple services', () => {
		expect(getEnvironmentVariableCount(getEnvironmentVariables(app), getCustomEnvironmentVariables(app))).toBe(2)
	})

	test('selects a predefined value and resets to the app default', async () => {
		const appWithOptions: UserApp = {
			...app,
			environment: {
				exposed: [
					{
						name: 'GPU_ACCELERATOR',
						services: ['server'],
						default: 'auto',
						options: ['auto', 'cuda', 'rocm', 'intel'],
						note: null,
						value: null,
					},
				],
				custom: [],
				services: ['server'],
				serviceImages: {},
			},
		}

		const rendered = renderSettings(appWithOptions)

		const trigger = [...rendered.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'auto')
		expect(trigger).toBeDefined()
		expect(rendered.querySelector('input')).toBeNull()

		await act(async () => {
			trigger?.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0}))
		})
		const options = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
		const appDefault = options.find((option) => option.textContent?.includes('auto'))
		const cuda = options.find((option) => option.textContent?.includes('cuda'))
		expect(appDefault?.textContent).toContain('Default')
		expect(appDefault?.getAttribute('aria-checked')).toBe('true')
		expect(cuda?.getAttribute('aria-checked')).toBe('false')

		await act(async () => cuda?.click())
		expect(trigger?.textContent).toContain('cuda')

		await act(async () => {
			trigger?.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0}))
		})
		const reset = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((option) =>
			option.textContent?.includes('auto'),
		)
		await act(async () => reset?.click())
		expect(trigger?.textContent).toContain('auto')
	})

	test('keeps variables without predefined values as text inputs', () => {
		const rendered = renderSettings(app)

		expect(rendered.querySelector('input')?.getAttribute('value')).toBe('2000')
	})
})
