// @vitest-environment jsdom

import {act, type ComponentProps} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {AccountDock} from '@/modules/auth/account-dock'

vi.mock('motion/react', async () => {
	const React = await import('react')

	type MotionProps = {
		animate?: unknown
		drag?: unknown
		dragConstraints?: unknown
		dragElastic?: unknown
		dragMomentum?: unknown
		initial?: unknown
		transition?: unknown
		whileHover?: unknown
		whileTap?: unknown
	}
	type DivProps = React.ComponentPropsWithoutRef<'div'> & MotionProps
	type ButtonProps = React.ComponentPropsWithoutRef<'button'> & MotionProps

	const MotionDiv = React.forwardRef<HTMLDivElement, DivProps>((props, ref) => {
		const domProps = {...props}
		delete domProps.animate
		delete domProps.drag
		delete domProps.dragConstraints
		delete domProps.dragElastic
		delete domProps.dragMomentum
		delete domProps.initial
		delete domProps.transition
		return <div ref={ref} {...domProps} />
	})
	const MotionButton = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
		const domProps = {...props}
		delete domProps.animate
		delete domProps.initial
		delete domProps.transition
		delete domProps.whileHover
		delete domProps.whileTap
		return <button ref={ref} {...domProps} />
	})

	return {motion: {button: MotionButton, div: MotionDiv}}
})

vi.mock('@/components/ui/glass', () => ({Glass: () => null, REFRACT: false}))
vi.mock('@/modules/auth/account-avatar', () => ({
	AccountAvatar: ({name}: {name: string}) => <span>{name}</span>,
}))
vi.mock('@/modules/auth/use-account-dock-motion', async () => {
	const React = await import('react')
	return {
		dockSpring: {},
		useAccountDockMotion: ({onSelect}: {onSelect: (index: number) => void}) => ({
			viewportRef: React.useRef<HTMLDivElement>(null),
			stripX: 0,
			lensStyle: {},
			dragConstraints: {left: 0, right: 0},
			reduceMotion: true,
			onPointerDownCapture: vi.fn(),
			onDragStart: vi.fn(),
			onDrag: vi.fn(),
			onDragEnd: vi.fn(),
			onAccountClick: onSelect,
		}),
	}
})

const accounts = Array.from({length: 5}, (_, index) => ({userId: String(index), name: `Account ${index}`}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderDock(overrides: Partial<ComponentProps<typeof AccountDock>> = {}) {
	const container = document.createElement('div')
	document.body.appendChild(container)
	const root = createRoot(container)
	const props: ComponentProps<typeof AccountDock> = {
		accounts,
		selectedIndex: 2,
		hoveredIndex: null,
		chosen: false,
		disabled: false,
		onSelect: vi.fn(),
		onBrowse: vi.fn(),
		onHover: vi.fn(),
		...overrides,
	}

	act(() => root.render(<AccountDock {...props} />))
	return {
		buttons: [...container.querySelectorAll('button')],
		props,
		rerender: (nextProps: Partial<ComponentProps<typeof AccountDock>>) =>
			act(() => root.render(<AccountDock {...props} {...nextProps} />)),
		unmount: () => act(() => root.unmount()),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

describe('AccountDock keyboard navigation', () => {
	it('keeps only the selected account in the tab order and browses focused accounts', () => {
		const view = renderDock()
		expect(view.buttons.map((button) => button.tabIndex)).toEqual([-1, -1, 0, -1, -1])

		act(() => view.buttons[0].focus())
		expect(view.props.onBrowse).toHaveBeenCalledWith(0)
		view.unmount()
	})

	it('moves focus and selection with the arrow keys', () => {
		const view = renderDock()
		act(() => view.buttons[2].focus())

		const right = new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true})
		act(() => view.buttons[2].dispatchEvent(right))

		expect(right.defaultPrevented).toBe(true)
		expect(document.activeElement).toBe(view.buttons[3])
		expect(view.props.onBrowse).toHaveBeenLastCalledWith(3)
		view.rerender({selectedIndex: 3})

		const left = new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true, cancelable: true})
		act(() => view.buttons[3].dispatchEvent(left))

		expect(left.defaultPrevented).toBe(true)
		expect(document.activeElement).toBe(view.buttons[2])
		expect(view.props.onBrowse).toHaveBeenLastCalledWith(2)
		view.unmount()
	})

	it('removes every account from interaction while authentication is pending', () => {
		const view = renderDock({disabled: true})

		expect(view.buttons.every((button) => button.disabled)).toBe(true)
		act(() => view.buttons[2].click())
		const right = new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true})
		act(() => view.buttons[2].dispatchEvent(right))

		expect(view.props.onSelect).not.toHaveBeenCalled()
		expect(view.props.onBrowse).not.toHaveBeenCalled()
		view.unmount()
	})
})
