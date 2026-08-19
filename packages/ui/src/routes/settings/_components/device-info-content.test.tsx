// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {GpuInfoRows} from './device-info-content'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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

describe('GPU device info rows', () => {
	it('lists all GPUs in one row, badged and with vendor lines when there are several', () => {
		act(() =>
			root.render(
				<GpuInfoRows
					label='GPU'
					gpus={[
						{vendor: 'NVIDIA Corporation', model: 'GA104 [GeForce RTX 3060]'},
						{vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]', model: 'Strix Halo [Radeon Graphics]'},
					]}
				/>,
			),
		)

		// One row labeled "GPU"; each device shows a GPU n badge, its spec-sheet
		// model name (codename kept, marketing name in parens), and vendor line
		expect([...container.children].map((row) => row.textContent)).toStrictEqual([
			'GPU' +
				'GPU 1GA104 (GeForce RTX 3060)NVIDIA Corporation' +
				'GPU 2Strix Halo (Radeon Graphics)Advanced Micro Devices, Inc. [AMD/ATI]',
		])
	})

	it('drops the badge and vendor line for a single GPU', () => {
		act(() =>
			root.render(
				<GpuInfoRows label='GPU' gpus={[{vendor: 'NVIDIA Corporation', model: 'GA104 [GeForce RTX 3060]'}]} />,
			),
		)

		expect([...container.children].map((row) => row.textContent)).toStrictEqual(['GPUGA104 (GeForce RTX 3060)'])
	})

	it('does not render empty controller records', () => {
		act(() => root.render(<GpuInfoRows label='GPU' gpus={[{vendor: '', model: ''}]} />))

		expect(container.children).toHaveLength(0)
	})
})
