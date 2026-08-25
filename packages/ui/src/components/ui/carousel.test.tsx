// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {CarouselDots, useCarouselAutoAdvance, type CarouselApi} from './carousel'

vi.mock('motion/react', () => ({useReducedMotion: () => false}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let progress: number | undefined

function AutoAdvanceHarness({api, paused}: {api: CarouselApi; paused: boolean}) {
	progress = useCarouselAutoAdvance(api, {intervalMs: 1000, paused})
	return null
}

describe('carousel accessibility', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.useRealTimers()
	})

	test('keeps slide dots in the tab order and identifies the active slide', () => {
		act(() => root.render(<CarouselDots count={3} activeIndex={1} onSelect={() => {}} />))

		const dots = [...container.querySelectorAll('button')]
		expect(dots).toHaveLength(3)
		expect(dots.every((dot) => dot.tabIndex === 0)).toBe(true)
		expect(dots[1]?.getAttribute('aria-current')).toBe('true')
	})

	test('holds autoplay while paused and starts a fresh countdown on resume', () => {
		vi.useFakeTimers()
		const scrollNext = vi.fn()
		const api = {
			on: vi.fn(),
			off: vi.fn(),
			canScrollNext: vi.fn(() => true),
			scrollNext,
			scrollTo: vi.fn(),
		} as unknown as CarouselApi

		act(() => root.render(<AutoAdvanceHarness api={api} paused={false} />))
		act(() => vi.advanceTimersByTime(500))
		expect(progress).toBeGreaterThan(0)

		act(() => root.render(<AutoAdvanceHarness api={api} paused />))
		const heldProgress = progress
		act(() => vi.advanceTimersByTime(1000))
		expect(progress).toBe(heldProgress)
		expect(scrollNext).not.toHaveBeenCalled()

		act(() => root.render(<AutoAdvanceHarness api={api} paused={false} />))
		expect(progress).toBe(0)
		act(() => vi.advanceTimersByTime(1000))
		expect(scrollNext).toHaveBeenCalledTimes(1)
	})
})
