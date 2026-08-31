// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {usePhotosEvents} from '@/features/photos/hooks/use-photos-events'

type SubscriptionOptions = {
	onData: (data: unknown) => void
	onError: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
	subscriptions: new Map<string, SubscriptionOptions>(),
	statusData: undefined as unknown,
	setStatus: vi.fn(),
	cancelStatus: vi.fn(async () => {}),
	invalidateSummary: vi.fn(),
	invalidateSources: vi.fn(),
	invalidateAlbums: vi.fn(),
	invalidateItem: vi.fn(),
	invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
	const original = await importOriginal<typeof import('@tanstack/react-query')>()
	return {
		...original,
		useQueryClient: () => ({
			invalidateQueries: mocks.invalidateQueries,
			getQueryCache: () => ({findAll: () => []}),
		}),
	}
})

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({
			photos: {
				library: {
					summary: {invalidate: mocks.invalidateSummary},
					status: {cancel: mocks.cancelStatus, getData: () => mocks.statusData, setData: mocks.setStatus},
				},
				sources: {invalidate: mocks.invalidateSources},
				albums: {invalidate: mocks.invalidateAlbums},
				items: {get: {invalidate: mocks.invalidateItem}},
			},
		}),
		eventBus: {
			listen: {
				useSubscription: ({event}: {event: string}, options: SubscriptionOptions) => {
					mocks.subscriptions.set(event, options)
				},
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container!: HTMLDivElement
let root!: Root

function Harness() {
	usePhotosEvents()
	return null
}

beforeEach(() => {
	vi.useFakeTimers()
	mocks.statusData = undefined
	mocks.setStatus.mockImplementation((_input, state) => {
		mocks.statusData = state
	})
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root.render(<Harness />))
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	mocks.subscriptions.clear()
	vi.useRealTimers()
	vi.clearAllMocks()
})

it('cancels an older query before writing an indexing snapshot into the status cache', async () => {
	const state = {phase: 'enriching', completed: 2, total: 4, percentage: 50}
	await act(async () => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(state)
		await Promise.resolve()
	})
	expect(mocks.cancelStatus).toHaveBeenCalledOnce()
	expect(mocks.setStatus).toHaveBeenCalledWith(undefined, state)
})

it('does not let an older cancellation publish over a newer progress event', async () => {
	let releaseFirst!: () => void
	let releaseSecond!: () => void
	mocks.cancelStatus
		.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
		.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseSecond = resolve)))
	const enriching = {phase: 'enriching', completed: 2, total: 4, percentage: 50}
	const ready = {phase: 'ready', completed: 4, total: 4, percentage: 100}

	act(() => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(enriching)
		mocks.subscriptions.get('photos:indexing-progress')?.onData(ready)
	})
	await act(async () => releaseSecond())
	await act(async () => releaseFirst())

	expect(mocks.setStatus).toHaveBeenCalledOnce()
	expect(mocks.setStatus).toHaveBeenCalledWith(undefined, ready)
})

it('keeps generic Photos changes from refetching indexing status', () => {
	act(() => {
		mocks.subscriptions.get('photos:change')?.onData({accountIds: ['Alice']})
		vi.advanceTimersByTime(1000)
	})

	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.setStatus).not.toHaveBeenCalled()
})

it('uses the bounded library refresh when indexing becomes ready', async () => {
	mocks.statusData = {phase: 'enriching', completed: 2, total: 4, percentage: 50}
	const ready = {phase: 'ready', completed: 4, total: 4, percentage: 100}
	await act(async () => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(ready)
		await Promise.resolve()
		vi.advanceTimersByTime(1000)
	})

	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.invalidateSources).toHaveBeenCalledOnce()
	expect(mocks.invalidateAlbums).toHaveBeenCalledOnce()
	expect(mocks.invalidateItem).toHaveBeenCalledOnce()
	expect(mocks.invalidateQueries).toHaveBeenCalledOnce()
})

it('does not refresh cold data when the initial indexing seed is already ready', async () => {
	const ready = {phase: 'ready', completed: 4, total: 4, percentage: 100}
	await act(async () => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(ready)
		await Promise.resolve()
		vi.advanceTimersByTime(1000)
	})

	expect(mocks.setStatus).toHaveBeenCalledWith(undefined, ready)
	expect(mocks.invalidateSummary).not.toHaveBeenCalled()
	expect(mocks.invalidateQueries).not.toHaveBeenCalled()
})
