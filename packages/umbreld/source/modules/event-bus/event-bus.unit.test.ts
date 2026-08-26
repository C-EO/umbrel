import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import EventBus from './event-bus.js'

afterEach(() => vi.useRealTimers())

function createEventBus() {
	const logger = {log: vi.fn(), verbose: vi.fn(), error: vi.fn()}
	const umbreld = {
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld

	return {eventBus: new EventBus(umbreld), logger}
}

describe('emitFileChanges()', () => {
	test('delivers every event through a bounded rolling worker pool', async () => {
		const {eventBus} = createEventBus()
		let active = 0
		let maximumActive = 0
		const paths: string[] = []
		eventBus.on('files:watcher:change', async ({path}) => {
			paths.push(path)
			active++
			maximumActive = Math.max(maximumActive, active)
			await new Promise((resolve) => setTimeout(resolve, 1))
			active--
		})
		const events = Array.from({length: 25}, (_, index) => ({type: 'create' as const, path: `/tmp/${index}`}))

		await eventBus.emitFileChanges(events, {concurrency: 4})

		expect(paths).toStrictEqual(events.map(({path}) => path))
		expect(maximumActive).toBeLessThanOrEqual(4)
	})

	test('starts the next event as soon as any worker becomes available', async () => {
		const {eventBus} = createEventBus()
		const releases = new Map<string, () => void>()
		const started: string[] = []
		eventBus.on('files:watcher:change', ({path}) => {
			started.push(path)
			return new Promise<void>((resolve) => releases.set(path, resolve))
		})
		const events = Array.from({length: 3}, (_, index) => ({type: 'create' as const, path: `/tmp/${index}`}))

		const dispatch = eventBus.emitFileChanges(events, {concurrency: 2, timeoutMs: 10_000})
		await vi.waitFor(() => expect(started).toStrictEqual(['/tmp/0', '/tmp/1']))
		releases.get('/tmp/0')!()
		await vi.waitFor(() => expect(started).toStrictEqual(['/tmp/0', '/tmp/1', '/tmp/2']))
		releases.get('/tmp/1')!()
		releases.get('/tmp/2')!()

		await dispatch
	})

	test('releases a scheduler slot on timeout without cancelling the original emit', async () => {
		vi.useFakeTimers()
		const {eventBus, logger} = createEventBus()
		let releaseFirst!: () => void
		let firstSettled = false
		const listener = vi.fn(({path}: {path: string}) => {
			if (path === '/tmp/slow') {
				return new Promise<void>((resolve) => (releaseFirst = resolve)).then(() => {
					firstSettled = true
				})
			}
		})
		eventBus.on('files:watcher:change', listener)

		const dispatch = eventBus.emitFileChanges(
			[
				{type: 'create', path: '/tmp/slow'},
				{type: 'create', path: '/tmp/next'},
			],
			{concurrency: 1, timeoutMs: 1000},
		)
		await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
		await vi.advanceTimersByTimeAsync(1000)
		await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
		await dispatch

		expect(firstSettled).toBe(false)
		expect(logger.error).toHaveBeenCalledOnce()
		expect(logger.error).toHaveBeenCalledWith(
			'File event handlers exceeded 1000ms; continuing to dispatch the remaining events',
		)
		releaseFirst()
		await vi.waitFor(() => expect(firstSettled).toBe(true))
	})

	test('rejects invalid concurrency without emitting events', async () => {
		const {eventBus} = createEventBus()
		const listener = vi.fn()
		eventBus.on('files:watcher:change', listener)

		await expect(eventBus.emitFileChanges([{type: 'delete', path: '/tmp/example'}], {concurrency: 0})).rejects.toThrow(
			'concurrency must be positive',
		)
		expect(listener).not.toHaveBeenCalled()
	})

	test('rejects invalid timeouts without emitting events', async () => {
		const {eventBus} = createEventBus()
		const listener = vi.fn()
		eventBus.on('files:watcher:change', listener)

		await expect(eventBus.emitFileChanges([{type: 'delete', path: '/tmp/example'}], {timeoutMs: 0})).rejects.toThrow(
			'timeout must be positive',
		)
		expect(listener).not.toHaveBeenCalled()
	})
})
