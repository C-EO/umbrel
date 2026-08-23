// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {AUTH_TOKEN_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'

import {deleteAccountAvatar, uploadAccountAvatar, useAccountAvatar} from './use-account-avatar'

const mocks = vi.hoisted(() => ({
	setAccounts: vi.fn(),
	setCurrent: vi.fn(),
	invalidateAccounts: vi.fn(async () => undefined),
	invalidateCurrent: vi.fn(async () => undefined),
}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({
			user: {
				listAccounts: {setData: mocks.setAccounts, invalidate: mocks.invalidateAccounts},
				get: {setData: mocks.setCurrent, invalidate: mocks.invalidateCurrent},
			},
		}),
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let avatar: ReturnType<typeof useAccountAvatar>
let root: ReturnType<typeof createRoot>

function Harness() {
	avatar = useAccountAvatar()
	return <output>{avatar.isPending ? 'pending' : 'idle'}</output>
}

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'dashboard-token')
	root = createRoot(document.createElement('div'))
	act(() => root.render(<Harness />))
})

afterEach(() => {
	act(() => root.unmount())
	localStorage.clear()
	vi.unstubAllGlobals()
})

describe('account avatar client', () => {
	test('sends raw authenticated PUT and DELETE requests', async () => {
		const fetch = vi.fn(
			async (_url: string, options: RequestInit) =>
				new Response(JSON.stringify({userId: 'Alice', avatarUrl: options.method === 'PUT' ? '/avatar.webp' : null}), {
					status: 200,
				}),
		)
		vi.stubGlobal('fetch', fetch)
		const file = new File(['image'], 'avatar.png', {type: 'image/png'})

		await expect(uploadAccountAvatar('Alice', file)).resolves.toEqual({userId: 'Alice', avatarUrl: '/avatar.webp'})
		await expect(deleteAccountAvatar('Alice')).resolves.toEqual({userId: 'Alice', avatarUrl: null})
		expect(fetch).toHaveBeenNthCalledWith(1, '/api/accounts/Alice/avatar', {
			method: 'PUT',
			headers: {Authorization: 'Bearer dashboard-token'},
			body: file,
		})
		expect(fetch).toHaveBeenNthCalledWith(2, '/api/accounts/Alice/avatar', {
			method: 'DELETE',
			headers: {Authorization: 'Bearer dashboard-token'},
		})
	})

	test('patches list and current-account caches, then revalidates both', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({userId: 'Alice', avatarUrl: '/avatar.webp'}), {status: 200})),
		)
		await act(async () => avatar.upload('Alice', new File(['image'], 'avatar.png')))

		const patchAccounts = mocks.setAccounts.mock.calls[0][1]
		expect(
			patchAccounts([
				{userId: '0', name: 'Owner'},
				{userId: 'Alice', name: 'Alice'},
			]),
		).toEqual([
			{userId: '0', name: 'Owner'},
			{userId: 'Alice', name: 'Alice', avatarUrl: '/avatar.webp'},
		])
		const patchCurrent = mocks.setCurrent.mock.calls[0][1]
		expect(patchCurrent({userId: 'Alice', name: 'Alice'})).toEqual({
			userId: 'Alice',
			name: 'Alice',
			avatarUrl: '/avatar.webp',
		})
		expect(mocks.invalidateAccounts).toHaveBeenCalledOnce()
		expect(mocks.invalidateCurrent).toHaveBeenCalledOnce()
	})
})
