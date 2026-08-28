// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import {useGpuForUi} from './use-gpu'

const {useQuery} = vi.hoisted(() => ({useQuery: vi.fn()}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {system: {gpuUsage: {useQuery}}},
}))

vi.mock('react-i18next', () => ({
	useTranslation: () => ({t: (key: string) => (key === 'memory' ? 'Memory' : key), i18n: {language: 'en'}}),
	initReactI18next: {type: '3rdParty', init: vi.fn()},
}))

afterEach(() => vi.resetAllMocks())
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let current!: ReturnType<typeof useGpuForUi>

function Probe({poll}: {poll?: boolean}) {
	current = useGpuForUi({poll})
	return null
}

function renderGpuHook(poll?: boolean) {
	const container = document.createElement('div')
	const root = createRoot(container)
	act(() => root.render(<Probe poll={poll} />))
	return {result: () => current, unmount: () => act(() => root.unmount())}
}

test('formats GPU utilization, memory, devices, and app attribution for Live Usage', () => {
	useQuery.mockReturnValue({
		isLoading: false,
		data: {
			totalUsed: 42.2,
			memoryUsed: 2 * 1024 ** 3,
			system: 12.2,
			systemMemoryUsed: 512 * 1024 ** 2,
			apps: [{id: 'ai-app', used: 30, memoryUsed: 1.5 * 1024 ** 3}],
			devices: [
				{
					id: '0000:c7:00.0',
					vendor: 'AMD',
					model: 'Strix Halo',
					totalUsed: 42.2,
					dedicatedMemory: {total: 1024 ** 3, used: 256 * 1024 ** 2},
					sharedMemory: {used: 1.75 * 1024 ** 3},
				},
			],
		},
	})

	const view = renderGpuHook(true)

	// Polling backs off to a slow recheck only when we know no GPU is present
	// (eGPU hotplug); unknown data (cold start / failed fetch) stays fast
	const [, queryOptions] = useQuery.mock.calls[0]
	expect(queryOptions.retry).toBe(false)
	expect(queryOptions.refetchInterval({state: {data: {devices: [{}]}}})).toBe(2000)
	expect(queryOptions.refetchInterval({state: {data: {devices: []}}})).toBe(30_000)
	expect(queryOptions.refetchInterval({state: {data: undefined}})).toBe(2000)
	expect(view.result()).toMatchObject({
		isLoading: false,
		hasGpu: true,
		value: '43%',
		secondaryValue: '2.15 GB memory',
		progress: 0.42200000000000004,
		apps: [
			{id: 'ai-app', used: 30, memoryUsed: 1.5 * 1024 ** 3},
			{id: 'umbreld-system', used: 12.2, memoryUsed: 512 * 1024 ** 2},
		],
	})
	view.unmount()
})

test('does not advertise a GPU tab when no devices are available', () => {
	useQuery.mockReturnValue({
		isLoading: false,
		data: {totalUsed: null, memoryUsed: 0, system: 0, systemMemoryUsed: 0, apps: [], devices: []},
	})

	const view = renderGpuHook()
	expect(view.result().hasGpu).toBe(false)
	expect(view.result().apps).toStrictEqual([])
	view.unmount()
})
