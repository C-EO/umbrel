// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, it, vi} from 'vitest'

import {SpecRow, Stepper} from './spec-form'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
})

it('names both step actions and associates the controls with their row label', () => {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	const onStep = vi.fn()

	act(() =>
		root?.render(
			<SpecRow label='Processor'>
				<Stepper
					display='2 cores'
					onStep={onStep}
					canDecrement
					canIncrement
					decrementLabel='Decrease processor cores'
					incrementLabel='Increase processor cores'
				/>
			</SpecRow>,
		),
	)

	const group = container.querySelector('[role="group"]')
	const labelId = group?.getAttribute('aria-labelledby')
	expect(labelId).toBeTruthy()
	expect(document.getElementById(labelId!)?.textContent).toBe('Processor')
	expect(container.querySelector('button[aria-label="Decrease processor cores"]')).not.toBeNull()
	expect(container.querySelector('button[aria-label="Increase processor cores"]')).not.toBeNull()
})
