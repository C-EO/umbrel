// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {CarouselDots} from './carousel'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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
	})

	test('keeps slide dots in the tab order and identifies the active slide', () => {
		act(() => root.render(<CarouselDots count={3} activeIndex={1} onSelect={() => {}} />))

		const dots = [...container.querySelectorAll('button')]
		expect(dots).toHaveLength(3)
		expect(dots.every((dot) => dot.tabIndex === 0)).toBe(true)
		expect(dots[1]?.getAttribute('aria-current')).toBe('true')
	})
})
