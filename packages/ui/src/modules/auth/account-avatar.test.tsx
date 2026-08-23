// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {AccountAvatar} from './account-avatar'

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

function render(avatarUrl?: string) {
	act(() => root.render(<AccountAvatar name='Alice' userId='Alice' avatarUrl={avatarUrl} />))
}

describe('AccountAvatar', () => {
	test('keeps the deterministic fallback beneath a successful uploaded image', () => {
		render('/api/accounts/Alice/avatar/one.webp')
		expect(container.textContent).toBe('A')
		expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/accounts/Alice/avatar/one.webp')
	})

	test('falls back on image failure and retries when the URL changes or remounts', () => {
		render('/api/accounts/Alice/avatar/one.webp')
		act(() => container.querySelector('img')?.dispatchEvent(new Event('error')))
		expect(container.querySelector('img')).toBeNull()
		expect(container.textContent).toBe('A')

		render('/api/accounts/Alice/avatar/two.webp')
		expect(container.querySelector('img')?.getAttribute('src')).toContain('two.webp')

		render()
		render('/api/accounts/Alice/avatar/two.webp')
		expect(container.querySelector('img')?.getAttribute('src')).toContain('two.webp')
	})
})
