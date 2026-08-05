// @vitest-environment jsdom

import {Command as CommandPrimitive} from 'cmdk'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {addDialogToLocation, SettingsCmdkSearchProvider, shouldReplaceSettingsNavigation} from './cmdk-search-provider'

vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({
		t: (key: string) => (key === 'network.hostname' ? 'Nom d’hôte sécurisé' : key),
	}),
}))
vi.mock('@/features/backups/hooks/use-backups', () => ({
	useBackups: () => ({repositories: []}),
}))
vi.mock('@/hooks/use-is-home-or-pro', () => ({
	useIsHomeOrPro: () => ({deviceName: 'Umbrel Home'}),
}))
vi.mock('@/providers/apps', () => ({
	systemAppsKeyed: {UMBREL_settings: {}},
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {user: {get: {useQuery: () => ({data: {role: 'owner'}, isLoading: false})}}},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {configurable: true, value: vi.fn()})
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
	delete (HTMLElement.prototype as {scrollIntoView?: unknown}).scrollIntoView
})

function renderSettingsResults(query: string) {
	act(() =>
		root.render(
			<MemoryRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
				<CommandPrimitive>
					<CommandPrimitive.Input value={query} readOnly />
					<CommandPrimitive.List>
						<SettingsCmdkSearchProvider query={query} close={() => {}} />
					</CommandPrimitive.List>
				</CommandPrimitive>
			</MemoryRouter>,
		),
	)
}

describe('Settings Command-K results', () => {
	it('survives cmdk filtering when an accentless query matched translated copy', () => {
		renderSettingsResults('hote securise')

		const renderedItem = container.querySelector('[cmdk-item]')
		expect(renderedItem).not.toBeNull()
		expect(renderedItem?.hasAttribute('hidden')).toBe(false)
		expect(renderedItem?.textContent).toContain('advanced-settings')
	})

	it('keeps staging-style fuzzy matches for compact queries', () => {
		renderSettingsResults('chpass')

		const visibleResults = [...container.querySelectorAll<HTMLElement>('[cmdk-item]:not([hidden])')]
		expect(visibleResults.some((item) => item.textContent?.includes('change-password'))).toBe(true)
	})

	it('opens the global logout dialog without changing the current page', () => {
		expect(
			addDialogToLocation(
				{pathname: '/files/Home/Documents', search: '?sort=name&dialog=old', hash: '#report'},
				'logout',
			),
		).toEqual({
			pathname: '/files/Home/Documents',
			search: 'sort=name&dialog=logout',
			hash: '#report',
		})
	})

	it('replaces history only when a command stays on the current route', () => {
		expect(shouldReplaceSettingsNavigation('/settings/users', '/settings/users?ownerPanel=sessions')).toBe(true)
		expect(shouldReplaceSettingsNavigation('/files/Home', '/settings/users?ownerPanel=sessions')).toBe(false)
	})
})
