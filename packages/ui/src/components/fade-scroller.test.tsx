// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {FadeScroller} from './fade-scroller'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
	static instances: ResizeObserverMock[] = []
	observed = new Set<Element>()
	observe = vi.fn((element: Element) => this.observed.add(element))
	unobserve = vi.fn((element: Element) => this.observed.delete(element))
	disconnect = vi.fn(() => this.observed.clear())

	constructor() {
		ResizeObserverMock.instances.push(this)
	}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	ResizeObserverMock.instances = []
	vi.stubGlobal('ResizeObserver', ResizeObserverMock)
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn(() => 1),
	)
	vi.stubGlobal('cancelAnimationFrame', vi.fn())
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
})

describe('FadeScroller geometry observation', () => {
	it('replaces observed children when a dynamic list swaps content', async () => {
		await act(async () => {
			root.render(
				<FadeScroller direction='y'>
					<div key='first' data-item='first' />
					<div key='stable' data-item='stable' />
				</FadeScroller>,
			)
		})

		const observer = ResizeObserverMock.instances[0]
		const first = container.querySelector('[data-item="first"]')!
		const stable = container.querySelector('[data-item="stable"]')!
		expect(observer.observed).toEqual(new Set([container.firstElementChild!, first, stable]))

		await act(async () => {
			root.render(
				<FadeScroller direction='y'>
					<div key='stable' data-item='stable' />
					<div key='replacement' data-item='replacement' />
				</FadeScroller>,
			)
			await Promise.resolve()
		})

		const replacement = container.querySelector('[data-item="replacement"]')!
		expect(observer.unobserve).toHaveBeenCalledWith(first)
		expect(observer.observed).toEqual(new Set([container.firstElementChild!, stable, replacement]))
	})
})
