// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {ListRowMobile, ListRowSwitchIndicator} from './list-row'
import {SettingsFilterPills} from './settings-page-controls'

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
	vi.unstubAllGlobals()
})

describe('settings control accessibility', () => {
	it('keeps every filter visible and exposes its selected state independently', () => {
		const onSelect = vi.fn()
		act(() =>
			root.render(
				<SettingsFilterPills
					activeFilter='account'
					labels={{
						all: 'All',
						account: 'Account',
						storage: 'Storage',
						system: 'System',
						troubleshoot: 'Troubleshoot',
					}}
					ariaLabel='Filter settings'
					onSelect={onSelect}
				/>,
			),
		)

		const buttons = [...container.querySelectorAll('button')]
		expect(buttons.map((button) => button.textContent)).toEqual(['All', 'Account', 'Storage', 'System', 'Troubleshoot'])
		expect(buttons.find((button) => button.textContent === 'Account')?.getAttribute('aria-pressed')).toBe('true')
		expect(buttons.find((button) => button.textContent === 'System')?.getAttribute('aria-pressed')).toBe('false')

		act(() => buttons.find((button) => button.textContent === 'System')?.click())
		expect(onSelect).toHaveBeenCalledWith('system')
	})

	it('uses one real button for a mobile row and its decorative switch state', () => {
		const onClick = vi.fn()
		act(() =>
			root.render(
				<ListRowMobile icon='/icon.svg' title='2FA' description='Secure account' onClick={onClick}>
					<ListRowSwitchIndicator checked />
				</ListRowMobile>,
			),
		)

		expect(container.querySelectorAll('button')).toHaveLength(1)
		act(() => container.querySelector<HTMLElement>('[aria-hidden="true"]')?.click())
		expect(onClick).toHaveBeenCalledTimes(1)
	})
})
