import {afterEach, describe, expect, test, vi} from 'vitest'

import {ThumbnailQueue} from './thumbnail-queue'

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

afterEach(() => vi.useRealTimers())

describe('ThumbnailQueue', () => {
	test('admits visible work nearest the viewport middle before overscan regardless of registration order', async () => {
		const queue = new ThumbnailQueue({capacity: 2})
		queue.priority = (index) => ({tier: index >= 10 && index <= 14 ? 0 : 1, distance: Math.abs(index - 12)})
		const granted: number[] = []
		for (const index of [7, 8, 9, 10, 11, 12, 13, 14, 15])
			queue.enqueue(
				() => index,
				() => granted.push(index),
			)

		await flush()

		expect(granted).toEqual([12, 11])
	})

	test('reads live priority whenever a slot frees', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		let focal = 0
		queue.priority = (index) => ({tier: 0, distance: Math.abs(index - focal)})
		const granted: number[] = []
		const first = queue.enqueue(
			() => 0,
			() => granted.push(0),
		)
		queue.enqueue(
			() => 10,
			() => granted.push(10),
		)
		queue.enqueue(
			() => 20,
			() => granted.push(20),
		)
		await flush()
		expect(granted).toEqual([0])

		focal = 20
		first.settle()

		expect(granted).toEqual([0, 20])
	})

	test('drops waiting work and frees granted work exactly once', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		const granted: number[] = []
		const first = queue.enqueue(
			() => 0,
			() => granted.push(0),
		)
		const removed = queue.enqueue(
			() => 1,
			() => granted.push(1),
		)
		queue.enqueue(
			() => 2,
			() => granted.push(2),
		)
		removed.release()
		await flush()

		first.release()
		first.release()

		expect(granted).toEqual([0, 2])
	})

	test('a stalled image cannot hold a slot forever', async () => {
		vi.useFakeTimers()
		const queue = new ThumbnailQueue({capacity: 1, stallMs: 100})
		const granted: number[] = []
		queue.enqueue(
			() => 0,
			() => granted.push(0),
		)
		queue.enqueue(
			() => 1,
			() => granted.push(1),
		)
		await flush()

		await vi.advanceTimersByTimeAsync(100)

		expect(granted).toEqual([0, 1])
	})
})
