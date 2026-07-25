// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {calculateDockLayout, type DockLayout} from '@/modules/auth/dock-geometry'
import {useAccountDockMotion} from '@/modules/auth/use-account-dock-motion'

const motionState = vi.hoisted(() => ({reduceMotion: false, jumps: 0}))

vi.mock('motion/react', async () => {
	const React = await import('react')

	class TestMotionValue {
		constructor(private value: number) {}

		get() {
			return this.value
		}

		set(value: number) {
			this.value = value
		}

		jump(value: number) {
			motionState.jumps += 1
			this.value = value
		}
	}

	return {
		useMotionValue: (initial: number) => React.useRef(new TestMotionValue(initial)).current,
		useReducedMotion: () => motionState.reduceMotion,
		useSpring: (source: TestMotionValue) => source,
		useTransform: (sources: TestMotionValue[], transform: (values: number[]) => number) => {
			const transformed = React.useRef(new TestMotionValue(0)).current
			transformed.get = () => transform(sources.map((source) => source.get()))
			return transformed
		},
	}
})

type HarnessProps = {
	layout: DockLayout
	selectedIndex: number
	hoveredIndex?: number | null
	chosen?: boolean
	disabled?: boolean
	onSelect: (index: number) => void
	onBrowse: (index: number) => void
	onHover: (index: number | null) => void
}

let currentMotion: ReturnType<typeof useAccountDockMotion>
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function Harness({
	layout,
	selectedIndex,
	hoveredIndex = null,
	chosen = false,
	disabled = false,
	onSelect,
	onBrowse,
	onHover,
}: HarnessProps) {
	currentMotion = useAccountDockMotion({
		layout,
		selectedIndex,
		hoveredIndex,
		chosen,
		disabled,
		canFloat: true,
		onSelect,
		onBrowse,
		onHover,
	})
	return <div ref={currentMotion.viewportRef} />
}

function renderHarness(props: HarnessProps) {
	const container = document.createElement('div')
	document.body.appendChild(container)
	const root = createRoot(container)

	act(() => root.render(<Harness {...props} />))
	const viewport = container.firstElementChild as HTMLDivElement
	vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
		x: 100,
		y: 200,
		left: 100,
		top: 200,
		right: 900,
		bottom: 380,
		width: 800,
		height: 180,
		toJSON: () => ({}),
	})

	return {
		container,
		root,
		rerender: (nextProps: HarnessProps) => act(() => root.render(<Harness {...nextProps} />)),
		unmount: () => act(() => root.unmount()),
	}
}

function pointerMove(clientX: number, clientY: number) {
	const event = new MouseEvent('pointermove', {clientX, clientY})
	Object.defineProperty(event, 'pointerType', {value: 'mouse'})
	act(() => window.dispatchEvent(event))
}

const callbacks = () => ({
	onSelect: vi.fn<(index: number) => void>(),
	onBrowse: vi.fn<(index: number) => void>(),
	onHover: vi.fn<(index: number | null) => void>(),
})

beforeEach(() => {
	motionState.reduceMotion = false
	motionState.jumps = 0
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: vi.fn(() => ({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	})
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

describe('useAccountDockMotion', () => {
	it('browses to the nearest account while dragging and wheeling', () => {
		vi.useFakeTimers()
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: false})
		const spies = callbacks()
		const view = renderHarness({layout, selectedIndex: 1, ...spies})

		act(() => {
			currentMotion.stripX.jump(-layout.centers[2])
			currentMotion.onDrag()
		})
		expect(spies.onBrowse).toHaveBeenLastCalledWith(2)

		spies.onBrowse.mockClear()
		act(() => currentMotion.stripX.jump(-layout.centers[1]))
		const wheel = new WheelEvent('wheel', {deltaX: 100, deltaY: 0, cancelable: true})
		act(() => view.container.firstElementChild?.dispatchEvent(wheel))

		expect(wheel.defaultPrevented).toBe(true)
		expect(spies.onBrowse).toHaveBeenLastCalledWith(2)
		view.unmount()
	})

	it('settles wheel browsing against the latest chosen-account geometry', () => {
		vi.useFakeTimers()
		const initialLayout = calculateDockLayout({accountCount: 5, selectedIndex: 2, chosen: true})
		const spies = callbacks()
		const view = renderHarness({layout: initialLayout, selectedIndex: 2, chosen: true, ...spies})

		act(() => currentMotion.stripX.jump(-initialLayout.centers[2]))
		const deltaX = initialLayout.centers[3] - initialLayout.centers[2]
		const wheel = new WheelEvent('wheel', {deltaX, deltaY: 0, cancelable: true})
		act(() => view.container.firstElementChild?.dispatchEvent(wheel))

		expect(spies.onBrowse).toHaveBeenLastCalledWith(3)

		const chosenLayout = calculateDockLayout({accountCount: 5, selectedIndex: 3, chosen: true})
		view.rerender({layout: chosenLayout, selectedIndex: 3, chosen: true, ...spies})
		act(() => vi.runAllTimers())

		expect(currentMotion.stripX.get()).toBe(-chosenLayout.centers[3])
		expect(chosenLayout.centers[3]).not.toBe(initialLayout.centers[3])
		view.unmount()
	})

	it('suppresses the click generated at the end of a drag', () => {
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: false})
		const spies = callbacks()
		const view = renderHarness({layout, selectedIndex: 1, ...spies})

		act(() => {
			currentMotion.onPointerDownCapture()
			currentMotion.onDragStart()
			currentMotion.onDragEnd()
			currentMotion.onAccountClick(2)
		})
		expect(spies.onSelect).not.toHaveBeenCalled()

		act(() => {
			currentMotion.onPointerDownCapture()
			currentMotion.onAccountClick(2)
		})
		expect(spies.onSelect).toHaveBeenCalledWith(2)
		view.unmount()
	})

	it('blocks every dock interaction and re-centers while disabled', () => {
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: true})
		const spies = callbacks()
		const view = renderHarness({layout, selectedIndex: 1, hoveredIndex: 2, chosen: true, ...spies})

		spies.onHover.mockClear()
		act(() => currentMotion.stripX.jump(-layout.centers[2]))
		view.rerender({layout, selectedIndex: 1, hoveredIndex: 2, chosen: true, disabled: true, ...spies})

		expect(currentMotion.stripX.get()).toBe(-layout.centers[1])
		expect(currentMotion.lensStyle.x.get()).toBe(0)
		expect(spies.onHover).toHaveBeenCalledWith(null)

		spies.onHover.mockClear()
		act(() => {
			currentMotion.onPointerDownCapture()
			currentMotion.onDragStart()
			currentMotion.stripX.jump(-layout.centers[2])
			currentMotion.onDrag()
			currentMotion.onDragEnd()
			currentMotion.onAccountClick(2)
		})
		pointerMove(800, 290)
		const wheel = new WheelEvent('wheel', {deltaX: 100, deltaY: 0, cancelable: true})
		act(() => view.container.firstElementChild?.dispatchEvent(wheel))

		expect(wheel.defaultPrevented).toBe(false)
		expect(spies.onSelect).not.toHaveBeenCalled()
		expect(spies.onBrowse).not.toHaveBeenCalled()
		expect(spies.onHover).not.toHaveBeenCalled()

		view.rerender({layout, selectedIndex: 1, chosen: true, disabled: false, ...spies})
		act(() => currentMotion.onAccountClick(2))
		expect(spies.onSelect).toHaveBeenCalledWith(2)
		view.unmount()
	})

	it('re-docks a free lens when an account is chosen', () => {
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: false})
		const spies = callbacks()
		const view = renderHarness({layout, selectedIndex: 1, ...spies})

		pointerMove(950, 100)
		expect(currentMotion.lensStyle.y.get()).not.toBe(0)

		const chosenLayout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: true})
		view.rerender({layout: chosenLayout, selectedIndex: 1, chosen: true, ...spies})
		expect(currentMotion.lensStyle.y.get()).toBe(0)
		expect(currentMotion.lensStyle.scale.get()).toBe(1)
		view.unmount()
	})

	it('keeps hover targeting active after an account is chosen', () => {
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: true})
		const spies = callbacks()
		const view = renderHarness({layout, selectedIndex: 1, chosen: true, ...spies})

		view.rerender({layout, selectedIndex: 1, hoveredIndex: 2, chosen: true, ...spies})

		expect(currentMotion.lensStyle.scale.get()).toBe(layout.sizes[2] / 112)
		view.unmount()
	})

	it('rebases the lens when choosing changes the dock geometry', () => {
		const pickerLayout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: false})
		const spies = callbacks()
		const view = renderHarness({
			layout: pickerLayout,
			selectedIndex: 1,
			hoveredIndex: 2,
			...spies,
		})

		const passwordLayout = calculateDockLayout({accountCount: 3, selectedIndex: 2, chosen: true})
		view.rerender({layout: passwordLayout, selectedIndex: 2, chosen: true, ...spies})

		expect(currentMotion.lensStyle.x.get()).toBe(0)
		view.unmount()
	})

	it('jumps directly to new targets when reduced motion is enabled', () => {
		motionState.reduceMotion = true
		const spies = callbacks()
		const firstLayout = calculateDockLayout({accountCount: 3, selectedIndex: 0, chosen: false})
		const view = renderHarness({layout: firstLayout, selectedIndex: 0, ...spies})
		const jumpsBeforeSelection = motionState.jumps

		const lastLayout = calculateDockLayout({accountCount: 3, selectedIndex: 2, chosen: false})
		view.rerender({layout: lastLayout, selectedIndex: 2, ...spies})

		expect(currentMotion.stripX.get()).toBe(-lastLayout.centers[2])
		expect(motionState.jumps).toBeGreaterThan(jumpsBeforeSelection)
		pointerMove(950, 100)
		expect(currentMotion.lensStyle.y.get()).toBe(0)
		view.unmount()
	})

	it('removes global, viewport, and timer resources on unmount', () => {
		vi.useFakeTimers()
		const addWindowListener = vi.spyOn(window, 'addEventListener')
		const removeWindowListener = vi.spyOn(window, 'removeEventListener')
		const removeDocumentListener = vi.spyOn(document.documentElement, 'removeEventListener')
		const clearTimer = vi.spyOn(window, 'clearTimeout')
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: false})
		const view = renderHarness({layout, selectedIndex: 1, ...callbacks()})
		const viewport = view.container.firstElementChild as HTMLDivElement
		const removeViewportListener = vi.spyOn(viewport, 'removeEventListener')
		const pointerHandler = addWindowListener.mock.calls.find(([event]) => event === 'pointermove')?.[1]

		act(() => currentMotion.onDragEnd())
		const clearCallsBeforeUnmount = clearTimer.mock.calls.length
		view.unmount()

		expect(removeWindowListener).toHaveBeenCalledWith('pointermove', pointerHandler)
		expect(removeWindowListener).toHaveBeenCalledWith('blur', expect.any(Function))
		expect(removeDocumentListener).toHaveBeenCalledWith('mouseleave', expect.any(Function))
		expect(removeViewportListener).toHaveBeenCalledWith('wheel', expect.any(Function))
		expect(clearTimer.mock.calls.length).toBeGreaterThan(clearCallsBeforeUnmount)
	})
})
