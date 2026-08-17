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
	it('lists each detected GPU with its model and vendor', () => {
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

		expect([...container.children].map((row) => row.textContent)).toStrictEqual([
			'GPU 1GA104 [GeForce RTX 3060]NVIDIA Corporation',
			'GPU 2Strix Halo [Radeon Graphics]Advanced Micro Devices, Inc. [AMD/ATI]',
		])
	})

	it('does not render empty controller records', () => {
		act(() => root.render(<GpuInfoRows label='GPU' gpus={[{vendor: '', model: ''}]} />))

		expect(container.children).toHaveLength(0)
	})
})
