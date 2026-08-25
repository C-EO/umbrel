// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {AppPageContent} from '@/features/app-store/components/app-page/app-page-content'
import type {RegistryApp} from '@/trpc/trpc'

import CommunityAppPage from '.'

const fixtures = vi.hoisted(() => ({
	app: {
		appStoreId: 'community-store',
		id: 'community-store-app',
		name: 'Community App',
		description: 'Description',
		version: '1.0.0',
		manifestVersion: '1.0.0',
		tagline: 'Tagline',
		icon: '/icon.png',
		category: 'files',
		website: 'https://example.com',
		support: 'https://example.com/support',
		gallery: [],
		compatible: true,
	} as RegistryApp,
}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		appStore: {
			registry: {
				useQuery: () => ({
					data: [{meta: {id: 'community-store', name: 'Community Store'}, apps: [fixtures.app]}],
					isLoading: false,
				}),
			},
		},
	},
}))
vi.mock('@/components/install-button', () => ({InstallButton: () => null}))
vi.mock('@/components/install-button-connected', () => ({InstallButtonConnected: () => null}))
vi.mock('@/features/app-store/components/app-page/app-hero', () => ({AppPageHero: () => null}))
vi.mock('@/features/app-store/components/app-page/app-page-content', () => ({AppPageContent: vi.fn(() => null)}))
vi.mock('@/modules/community-app-store/community-badge', () => ({CommunityBadge: () => null}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('CommunityAppPage', () => {
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
		vi.clearAllMocks()
	})

	test('wires community registry identity into dependency page paths', () => {
		act(() =>
			root.render(
				<MemoryRouter initialEntries={['/community-app-store/community-store/community-store-app']}>
					<Routes>
						<Route path='/community-app-store/:appStoreId/:appId' element={<CommunityAppPage />} />
					</Routes>
				</MemoryRouter>,
			),
		)

		const props = vi.mocked(AppPageContent).mock.calls[0]?.[0]
		expect(props?.registryId).toBe('community-store')
		expect(props?.makeAppPath?.(fixtures.app)).toBe('/community-app-store/community-store/community-store-app')
	})
})
