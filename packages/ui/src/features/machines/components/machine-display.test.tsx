// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, it, vi} from 'vitest'

import {FirstBootSetupOverlay} from './machine-display'

vi.mock('@/utils/i18n', () => ({
	t: (key: string) => key,
}))
vi.mock('@/features/machines/components/machine-console', () => ({
	MachineConsole: () => <div />,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
})

function renderOverlay(delayed: boolean, onOpenConsole = vi.fn()) {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root?.render(<FirstBootSetupOverlay osName='Debian' delayed={delayed} onOpenConsole={onOpenConsole} />))
	return {container, onOpenConsole}
}

it('keeps the normal unattended setup overlay non-interactive', () => {
	const {container} = renderOverlay(false)

	expect(container.textContent).toContain('machines.completing-setup')
	expect(container.querySelector('button')).toBeNull()
})

it('offers an explicit console escape hatch when setup is delayed', () => {
	const {container, onOpenConsole} = renderOverlay(true)
	const button = container.querySelector('button')

	expect(container.textContent).toContain('machines.setup-taking-longer')
	expect(container.textContent).toContain('machines.setup-taking-longer-description')
	expect(button?.textContent).toBe('machines.open-console')
	act(() => button?.click())
	expect(onOpenConsole).toHaveBeenCalledOnce()
})
