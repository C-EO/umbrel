// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {DeviceInfoContent, GpuInfoRows} from './device-info-content'

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => key}),
}))
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

describe('Storage device info row', () => {
	it('links non-Pro devices to Storage Manager', () => {
		act(() =>
			root.render(
				<MemoryRouter
					initialEntries={['/settings/device-info']}
					future={{v7_startTransition: true, v7_relativeSplatPath: true}}
				>
					<Routes>
						<Route
							path='/settings/device-info'
							element={<DeviceInfoContent umbrelHostEnvironment='raspberry-pi' storage='1 TB SSD' />}
						/>
						<Route path='/settings/storage' element={<div>Storage Manager destination</div>} />
					</Routes>
				</MemoryRouter>,
			),
		)

		const storageManagerButton = container.querySelector<HTMLButtonElement>('button[aria-label="storage-manager"]')
		expect(storageManagerButton).not.toBeNull()

		act(() => storageManagerButton?.click())

		expect(container.textContent).toContain('Storage Manager destination')
	})
})
