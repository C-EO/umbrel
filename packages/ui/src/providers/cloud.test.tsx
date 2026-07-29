// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {CloudActivityProvider, useCloudActivity} from '@/providers/cloud'

type Activity = {
	syncId: string
	bytesPerSecond: number
	transferredFiles: number
	transferredBytes: number
}

type SubscriptionOptions = {
	onData: (data: Activity[]) => void
	onError: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
	activitySnapshot: vi.fn<() => Promise<Activity[]>>(),
	subscriptionOptions: undefined as SubscriptionOptions | undefined,
	invalidateQueries: vi.fn(),
	invalidateSyncs: vi.fn(),
	querySyncs: vi.fn(async () => []),
}))

vi.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({invalidateQueries: mocks.invalidateQueries}),
}))
vi.mock('@/components/ui/toast', () => ({toast: {success: vi.fn()}}))
vi.mock('@/features/files/hooks/use-cloud', () => ({
	cloudSyncName: () => 'Cloud folder',
	wasSyncRemovedByUser: () => false,
}))
vi.mock('@/trpc/trpc', () => {
	const utils = {
		files: {cloud: {syncs: {invalidate: mocks.invalidateSyncs}}},
		client: {
			files: {
				cloud: {
					activity: {query: mocks.activitySnapshot},
					syncs: {query: mocks.querySyncs},
				},
			},
		},
	}
	return {
		trpcReact: {
			useUtils: () => utils,
			user: {get: {useQuery: () => ({data: {userId: 'Alice'}})}},
			eventBus: {
				listen: {
					useSubscription: (_input: unknown, options: SubscriptionOptions) => {
						mocks.subscriptionOptions = options
					},
				},
			},
			files: {cloud: {syncs: {useQuery: () => ({data: []})}}},
		},
	}
})
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container!: HTMLDivElement
let root!: Root

function Harness() {
	const {activities} = useCloudActivity()
	return <output>{JSON.stringify(activities)}</output>
}

const activity = (syncId: string, transferredBytes: number): Activity => ({
	syncId,
	bytesPerSecond: 10,
	transferredFiles: 1,
	transferredBytes,
})

const flush = () => act(async () => await Promise.resolve())

beforeEach(async () => {
	mocks.activitySnapshot.mockResolvedValue([])
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () =>
		root.render(
			<CloudActivityProvider>
				<Harness />
			</CloudActivityProvider>,
		),
	)
	await flush()
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	vi.restoreAllMocks()
	mocks.subscriptionOptions = undefined
})

describe('Cloud activity reconciliation', () => {
	it('keeps the last event visible until an authoritative recovery succeeds', async () => {
		const running = activity('sync-1', 20)
		act(() => mocks.subscriptionOptions?.onData([running]))

		let resolveSnapshot!: (value: Activity[]) => void
		mocks.activitySnapshot.mockImplementationOnce(
			() => new Promise<Activity[]>((resolve) => (resolveSnapshot = resolve)),
		)
		vi.spyOn(console, 'error').mockImplementation(() => {})
		act(() => mocks.subscriptionOptions?.onError(new Error('socket closed')))

		expect(container.textContent).toBe(JSON.stringify([running]))

		await act(async () => resolveSnapshot([]))
		expect(container.textContent).toBe('[]')
	})

	it('does not let a slow recovery overwrite a newer reconnect event', async () => {
		const beforeDisconnect = activity('sync-1', 20)
		const afterReconnect = activity('sync-1', 40)
		act(() => mocks.subscriptionOptions?.onData([beforeDisconnect]))

		let resolveSnapshot!: (value: Activity[]) => void
		mocks.activitySnapshot.mockImplementationOnce(
			() => new Promise<Activity[]>((resolve) => (resolveSnapshot = resolve)),
		)
		vi.spyOn(console, 'error').mockImplementation(() => {})
		act(() => mocks.subscriptionOptions?.onError(new Error('socket closed')))
		act(() => mocks.subscriptionOptions?.onData([afterReconnect]))

		await act(async () => resolveSnapshot([]))
		expect(container.textContent).toBe(JSON.stringify([afterReconnect]))
	})

	it('preserves the last event when the recovery query also fails', async () => {
		const running = activity('sync-1', 20)
		act(() => mocks.subscriptionOptions?.onData([running]))
		mocks.activitySnapshot.mockRejectedValueOnce(new Error('offline'))
		vi.spyOn(console, 'error').mockImplementation(() => {})

		act(() => mocks.subscriptionOptions?.onError(new Error('socket closed')))
		await flush()

		expect(container.textContent).toBe(JSON.stringify([running]))
	})
})
