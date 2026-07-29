// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {useCloudOAuth} from '@/features/files/hooks/use-cloud'

const mocks = vi.hoisted(() => ({
	begin: vi.fn(),
	complete: vi.fn(),
	cancel: vi.fn(async () => true),
	invalidateAccounts: vi.fn(),
	invalidateSyncs: vi.fn(),
	onComplete: vi.fn(),
	onFailure: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/features/files/utils/error-messages', () => ({getFilesErrorMessage: (message: string) => message}))
vi.mock('@/trpc/trpc', () => {
	const mutation = (mutateAsync: ReturnType<typeof vi.fn>) => ({
		useMutation: () => ({mutateAsync, isPending: false}),
	})
	return {
		trpcReact: {
			useUtils: () => ({
				files: {
					cloud: {
						accounts: {invalidate: mocks.invalidateAccounts},
						syncs: {invalidate: mocks.invalidateSyncs},
					},
				},
			}),
			files: {
				cloud: {
					oauthBegin: mutation(mocks.begin),
					oauthComplete: mutation(mocks.complete),
					oauthCancel: mutation(mocks.cancel),
				},
			},
		},
	}
})
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container!: HTMLDivElement
let root: Root | undefined
let oauth!: ReturnType<typeof useCloudOAuth>
let consentTab!: {location: {href: string}; close: ReturnType<typeof vi.fn>}

function Harness() {
	oauth = useCloudOAuth({onComplete: mocks.onComplete, onFailure: mocks.onFailure})
	return (
		<output>
			{String(oauth.isWaiting)}:{String(oauth.isPopupBlocked)}:{oauth.authorizationUrl ?? ''}
		</output>
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
	mocks.begin.mockResolvedValue({
		accountId: '11111111-1111-4111-8111-111111111111',
		sessionId: '22222222-2222-4222-8222-222222222222',
		authorizationUrl: 'https://provider.example/authorize',
		expiresInMs: 10 * 60 * 1000,
	})
	consentTab = {location: {href: ''}, close: vi.fn()}
	vi.spyOn(window, 'open').mockReturnValue(consentTab as unknown as Window)
	container = document.createElement('div')
	document.body.appendChild(container)
	const nextRoot = createRoot(container)
	root = nextRoot
	act(() => nextRoot.render(<Harness />))
})

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
	vi.restoreAllMocks()
	vi.useRealTimers()
})

describe('Cloud OAuth expiry', () => {
	it('uses the relative server TTL instead of either wall clock', async () => {
		await act(async () => oauth.begin({provider: 'google-drive'}))
		expect(container.textContent).toBe('true:false:https://provider.example/authorize')
		expect(consentTab.location.href).toBe('https://provider.example/authorize')

		// A wall-clock correction after receipt must not expire the local UX
		// early; only elapsed monotonic time counts.
		vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))
		await act(async () => vi.advanceTimersByTime(10 * 60 * 1000 - 1))
		expect(mocks.onFailure).not.toHaveBeenCalled()
		expect(container.textContent).toBe('true:false:https://provider.example/authorize')

		await act(async () => vi.advanceTimersByTime(1))
		expect(mocks.onFailure).toHaveBeenCalledWith('expired')
		expect(mocks.cancel).toHaveBeenCalledWith({
			accountId: '11111111-1111-4111-8111-111111111111',
			sessionId: '22222222-2222-4222-8222-222222222222',
		})
		expect(container.textContent).toBe('false:false:')
	})

	it('retains the authorization URL when the initial popup is blocked', async () => {
		vi.mocked(window.open).mockReturnValue(null)

		await act(async () => oauth.begin({provider: 'google-drive'}))

		expect(window.open).toHaveBeenCalledTimes(1)
		expect(window.open).toHaveBeenCalledWith('', '_blank')
		expect(container.textContent).toBe('true:true:https://provider.example/authorize')
		expect(mocks.cancel).not.toHaveBeenCalled()
		expect(mocks.onFailure).not.toHaveBeenCalled()
	})

	it('cancels a retained blocked-popup session when the flow is abandoned', async () => {
		vi.mocked(window.open).mockReturnValue(null)
		await act(async () => oauth.begin({provider: 'google-drive'}))

		act(() => root?.unmount())
		root = undefined

		expect(mocks.cancel).toHaveBeenCalledWith({
			accountId: '11111111-1111-4111-8111-111111111111',
			sessionId: '22222222-2222-4222-8222-222222222222',
		})
	})

	it('shares one completion across synchronous duplicate submissions', async () => {
		let resolveCompletion!: (result: {
			account: {id: string}
			locations: {locations: never[]; truncated: boolean}
		}) => void
		mocks.complete.mockReturnValue(
			new Promise((resolve) => {
				resolveCompletion = resolve
			}),
		)
		await act(async () => oauth.begin({provider: 'google-drive'}))

		let first!: Promise<void>
		let duplicate!: Promise<void>
		act(() => {
			first = oauth.complete('copy-code')
			duplicate = oauth.complete('copy-code')
		})

		expect(first).toBe(duplicate)
		expect(mocks.complete).toHaveBeenCalledOnce()
		expect(oauth.isCompleting).toBe(true)

		resolveCompletion({
			account: {id: '11111111-1111-4111-8111-111111111111'},
			locations: {locations: [], truncated: false},
		})
		await act(() => first)

		expect(mocks.onComplete).toHaveBeenCalledOnce()
		expect(oauth.isCompleting).toBe(false)
	})
})
