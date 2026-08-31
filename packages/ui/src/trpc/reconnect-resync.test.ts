import {afterEach, describe, expect, test, vi} from 'vitest'

import {createReconnectResyncController} from './reconnect-resync'

const COOLDOWN_MS = 5_000

afterEach(() => vi.useRealTimers())

describe('reconnect resync', () => {
	test('skips the initial open and resyncs after a close', () => {
		const onResync = vi.fn()
		const controller = createReconnectResyncController({cooldownMs: COOLDOWN_MS, onResync})

		controller.onOpen()
		expect(onResync).not.toHaveBeenCalled()

		controller.onClose()
		controller.onOpen()
		expect(onResync).toHaveBeenCalledOnce()
	})

	test('coalesces a reconnect burst into a trailing resync', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const onResync = vi.fn()
		const controller = createReconnectResyncController({cooldownMs: COOLDOWN_MS, onResync})

		controller.onOpen()
		controller.onClose()
		controller.onOpen()
		expect(onResync).toHaveBeenCalledOnce()

		vi.advanceTimersByTime(1_000)
		controller.onClose()
		controller.onOpen()
		expect(onResync).toHaveBeenCalledOnce()

		vi.advanceTimersByTime(COOLDOWN_MS - 1_001)
		expect(onResync).toHaveBeenCalledOnce()
		vi.advanceTimersByTime(1)
		expect(onResync).toHaveBeenCalledTimes(2)
	})

	test('keeps a trailing resync pending while the socket is closed', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const onResync = vi.fn()
		const controller = createReconnectResyncController({cooldownMs: COOLDOWN_MS, onResync})

		controller.onOpen()
		controller.onClose()
		controller.onOpen()
		expect(onResync).toHaveBeenCalledOnce()

		vi.advanceTimersByTime(1_000)
		controller.onClose()
		controller.onOpen()
		controller.onClose()
		vi.advanceTimersByTime(COOLDOWN_MS)
		expect(onResync).toHaveBeenCalledOnce()

		controller.onOpen()
		expect(onResync).toHaveBeenCalledTimes(2)
	})
})
