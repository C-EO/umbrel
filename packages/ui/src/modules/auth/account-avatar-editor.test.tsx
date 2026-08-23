// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {AccountAvatarEditor, type AccountAvatarControlsVisibility} from './account-avatar-editor'

const mocks = vi.hoisted(() => ({
	upload: vi.fn(),
	remove: vi.fn(async () => ({userId: 'Alice', avatarUrl: null})),
	authorizedHttpUrl: vi.fn(async (url: string) => `${url}&token=file-token`),
	miniBrowserProps: vi.fn(),
	homePath: '/Home',
}))

vi.mock('react-i18next', () => ({
	initReactI18next: {type: '3rdParty', init: vi.fn()},
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/features/files/components/mini-browser', () => ({
	MiniBrowser: (props: unknown) => {
		mocks.miniBrowserProps(props)
		return null
	},
}))
vi.mock('@/modules/auth/http-auth', () => ({authorizedHttpUrl: mocks.authorizedHttpUrl}))
vi.mock('@/modules/auth/use-account-avatar', () => ({
	useAccountAvatar: () => ({isPending: false, upload: mocks.upload, remove: mocks.remove}),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {user: {get: {useQuery: () => ({data: {homePath: mocks.homePath}})}}},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	vi.clearAllMocks()
	mocks.homePath = '/Home'
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function render(avatarUrl?: string, controlsVisibility: AccountAvatarControlsVisibility = 'always') {
	act(() =>
		root.render(
			<AccountAvatarEditor
				account={{userId: 'Alice', name: 'Alice', avatarUrl}}
				size={72}
				controlsVisibility={controlsVisibility}
			/>,
		),
	)
}

async function openCameraMenu() {
	const camera = container.querySelector<HTMLButtonElement>(
		'button[aria-label="avatar.select"], button[aria-label="avatar.replace"]',
	)
	await act(async () =>
		camera?.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0, ctrlKey: false})),
	)
	return camera
}

describe('AccountAvatarEditor', () => {
	test('opens the custom-machine-style Upload and Browse in Files menu from the icon-only camera', async () => {
		const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
		render()

		const camera = container.querySelector<HTMLButtonElement>('button[aria-label="avatar.select"]')
		expect(camera).not.toBeNull()
		expect(camera?.textContent).toBe('')
		expect(camera?.getAttribute('type')).toBe('button')
		expect(container.querySelector('button[aria-label="avatar.remove"]')).toBeNull()
		expect(container.textContent).not.toContain('avatar.sign-in-note')
		expect(container.querySelector('input')?.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')

		await openCameraMenu()
		const menuItems = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
		expect(menuItems.map((item) => item.textContent)).toEqual(['files-action.upload', 'files-action.browse-in-files'])
		expect(menuItems.every((item) => item.querySelector('svg, img'))).toBe(true)

		await act(async () => menuItems[0]?.click())
		expect(inputClick).toHaveBeenCalledOnce()
	})

	test('keeps hover controls available to keyboard focus', () => {
		render(undefined, 'hover')

		const camera = container.querySelector<HTMLButtonElement>('button[aria-label="avatar.select"]')
		expect(camera).not.toBeNull()
		act(() => camera?.focus())
		expect(document.activeElement).toBe(camera)
	})

	test('keeps both hover controls visible while the camera menu is open', async () => {
		render('/api/accounts/Alice/avatar/hash.webp', 'hover')

		const camera = container.querySelector<HTMLButtonElement>('button[aria-label="avatar.replace"]')
		const remove = container.querySelector<HTMLButtonElement>('button[aria-label="avatar.remove"]')
		expect(camera?.parentElement?.className).toContain('opacity-0')
		expect(remove?.parentElement?.className).toContain('opacity-0')

		await openCameraMenu()
		expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
		expect(camera?.parentElement?.className).not.toContain('opacity-0')
		expect(remove?.parentElement?.className).not.toContain('opacity-0')
	})

	test.each([
		['owner is editing a member', '/Home'],
		['member is editing themself', '/Users/Alice'],
	])('uses the current actor home when the %s', async (_scenario, homePath) => {
		mocks.homePath = homePath
		render()

		await openCameraMenu()
		const browse = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(item) => item.textContent === 'files-action.browse-in-files',
		)
		await act(async () => browse?.click())

		const browserProps = mocks.miniBrowserProps.mock.calls.at(-1)?.[0]
		expect(browserProps.rootPath).toBe(homePath)
	})

	test('uploads a supported image selected from Files', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				blob: async () => new Blob(['image'], {type: 'image/png'}),
			})),
		)
		render()

		await openCameraMenu()
		const browse = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(item) => item.textContent === 'files-action.browse-in-files',
		)
		await act(async () => browse?.click())

		const browserProps = mocks.miniBrowserProps.mock.calls.at(-1)?.[0]
		expect(browserProps).toMatchObject({
			open: true,
			preselectOnOpen: false,
			selectionMode: 'files-and-folders',
			title: 'avatar.select',
			selectButtonLabel: 'avatar.select',
		})
		expect(browserProps.selectableFilter({path: '/Home/avatar.jpeg', name: 'avatar.jpeg', type: 'file'})).toBe(true)
		expect(browserProps.selectableFilter({path: '/Home/avatar.gif', name: 'avatar.gif', type: 'file'})).toBe(false)
		expect(browserProps.selectableFilter({path: '/Home/photos', name: 'photos', type: 'directory'})).toBe(false)

		await act(async () => browserProps.onSelect('/Home/photos/avatar.png'))
		expect(mocks.authorizedHttpUrl).toHaveBeenCalledWith('/api/files/view?path=%2FHome%2Fphotos%2Favatar.png')
		expect(fetch).toHaveBeenCalledWith('/api/files/view?path=%2FHome%2Fphotos%2Favatar.png&token=file-token', {
			headers: {Accept: 'image/jpeg,image/png,image/webp'},
		})
		expect(mocks.upload).toHaveBeenCalledOnce()
		const [userId, file] = mocks.upload.mock.calls[0]
		expect(userId).toBe('Alice')
		expect(file).toBeInstanceOf(File)
		expect(file).toMatchObject({name: 'avatar.png', type: 'image/png'})
	})

	test('removes an uploaded avatar from the icon-only control', async () => {
		render('/api/accounts/Alice/avatar/hash.webp')

		const camera = container.querySelector<HTMLButtonElement>('button[aria-label="avatar.replace"]')
		const remove = container.querySelector<HTMLButtonElement>('button[aria-label="avatar.remove"]')
		expect(camera?.textContent).toBe('')
		expect(remove?.textContent).toBe('')

		await act(async () => remove?.click())
		expect(mocks.remove).toHaveBeenCalledWith('Alice')
	})
})
