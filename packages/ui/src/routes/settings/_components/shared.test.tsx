// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {SettingsAccountAvatar} from './shared'

const mocks = vi.hoisted(() => ({editorProps: vi.fn()}))

vi.mock('@/modules/auth/account-avatar-editor', () => ({
	AccountAvatarEditor: (props: {
		account: {name: string; userId: string; avatarUrl?: string}
		controlsVisibility: 'always' | 'hover'
	}) => {
		mocks.editorProps(props)
		return (
			<button type='button' aria-label='Edit avatar'>
				{props.account.avatarUrl ? <img src={props.account.avatarUrl} alt='' /> : props.account.name.charAt(0)}
			</button>
		)
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	vi.clearAllMocks()
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

describe('SettingsAccountAvatar', () => {
	test.each([
		['owner desktop', '0', '/api/accounts/0/avatar/hash.webp', 'hover'],
		['member mobile', 'Alice', undefined, 'always'],
	] as const)(
		'renders a direct editor for %s without competing navigation',
		(_surface, userId, avatarUrl, visibility) => {
			act(() =>
				root.render(
					<SettingsAccountAvatar name='Alice' userId={userId} avatarUrl={avatarUrl} controlsVisibility={visibility} />,
				),
			)

			expect(container.querySelector('a')).toBeNull()
			expect(container.querySelector('button[aria-label="Edit avatar"]')).not.toBeNull()
			expect(mocks.editorProps).toHaveBeenLastCalledWith(
				expect.objectContaining({
					account: {name: 'Alice', userId, avatarUrl},
					controlsVisibility: visibility,
				}),
			)
			if (avatarUrl) expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarUrl)
			else expect(container.textContent).toBe('A')
		},
	)
})
