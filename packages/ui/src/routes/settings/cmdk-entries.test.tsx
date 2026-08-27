// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {rankCmdkEntries, type CmdkEntry} from '@/components/cmdk-search'

import {addDialogToLocation, shouldReplaceSettingsNavigation, useSettingsCmdkEntries} from './cmdk-entries'

const translations: Record<string, string> = {
	'network.hostname': 'Nom d’hôte sécurisé',
	'change-password': 'Change password',
}

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => translations[key] ?? key}),
}))
vi.mock('@/features/backups/hooks/use-backups', () => ({
	useBackups: () => ({repositories: []}),
}))
vi.mock('@/hooks/use-is-home-or-pro', () => ({
	useIsHomeOrPro: () => ({deviceName: 'Umbrel Home'}),
}))
vi.mock('@/providers/apps', () => ({
	systemAppsKeyed: {UMBREL_settings: {icon: 'settings.svg'}},
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {user: {get: {useQuery: () => ({data: {role: 'owner'}, isLoading: false})}}},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function Probe({onEntries}: {onEntries: (entries: CmdkEntry[]) => void}) {
	onEntries(useSettingsCmdkEntries())
	return null
}

function renderEntries() {
	let entries: CmdkEntry[] = []
	act(() =>
		root.render(
			<MemoryRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
				<Probe onEntries={(rendered) => (entries = rendered)} />
			</MemoryRouter>,
		),
	)
	return entries
}

const ids = (entries: CmdkEntry[]) => entries.map(({id}) => id)

describe('Settings Command-K entries', () => {
	it('gives every settings command a unique, short id', () => {
		const entries = renderEntries()

		expect(entries.length).toBeGreaterThan(20)
		expect(new Set(ids(entries)).size).toBe(entries.length)
		expect(ids(entries).every((id) => /^settings:[a-z0-9-]+$/.test(id))).toBe(true)
	})

	it('shows the established actions without a query', () => {
		expect(ids(renderEntries().filter(({default: isDefault}) => isDefault))).toEqual([
			'settings:wallpaper',
			'settings:widgets',
			'settings:backups',
			'settings:restart',
		])
	})

	it('is found by an accentless query against translated nested copy', () => {
		const results = ids(rankCmdkEntries(renderEntries(), 'hote securise', 25))

		expect(results).toContain('settings:advanced')
		expect(results).toContain('settings:network')
	})

	it('is found by compact fuzzy queries', () => {
		expect(ids(rankCmdkEntries(renderEntries(), 'chpass', 25))).toEqual(['settings:change-password'])
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
