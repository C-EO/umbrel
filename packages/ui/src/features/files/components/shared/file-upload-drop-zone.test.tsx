// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {FileUploadDropZone} from '@/features/files/components/shared/file-upload-drop-zone'

const mocks = vi.hoisted(() => ({
	currentPath: '/Home/Documents',
	onDrop: undefined as undefined | ((files: File[]) => Promise<void>),
	pathOperations: vi.fn(),
	startUpload: vi.fn(),
	toastError: vi.fn(),
}))

vi.mock('react-dropzone', () => ({
	useDropzone: ({onDrop}: {onDrop: (files: File[]) => Promise<void>}) => {
		mocks.onDrop = onDrop
		return {
			getRootProps: () => ({}),
			getInputProps: () => ({}),
			isDragActive: false,
		}
	},
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: mocks.toastError}}))
vi.mock('@/features/files/hooks/use-navigate', () => ({
	useNavigate: () => ({currentPath: mocks.currentPath}),
}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({
	useIsFilesReadOnly: () => false,
}))
vi.mock('@/features/files/utils/error-messages', () => ({getFilesErrorMessage: (message: string) => message}))
vi.mock('@/providers/global-files', () => ({useGlobalFiles: () => ({startUpload: mocks.startUpload})}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({files: {pathOperations: {fetch: mocks.pathOperations}}}),
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root!: Root

beforeEach(() => {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() =>
		root.render(
			<FileUploadDropZone>
				<div>Files</div>
			</FileUploadDropZone>,
		),
	)
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	vi.clearAllMocks()
})

describe('FileUploadDropZone', () => {
	it('holds dropped files until destination writability resolves', async () => {
		let resolveOperations!: (operations: string[]) => void
		mocks.pathOperations.mockReturnValue(
			new Promise((resolve) => {
				resolveOperations = resolve
			}),
		)
		const file = new File(['report'], 'report.txt')

		const dropPromise = mocks.onDrop!([file])
		expect(mocks.startUpload).not.toHaveBeenCalled()

		resolveOperations(['writable'])
		await act(() => dropPromise)

		expect(mocks.startUpload).toHaveBeenCalledWith([file], '/Home/Documents')
	})

	it('shows an error instead of discarding a rejected drop', async () => {
		mocks.pathOperations.mockResolvedValue([])

		await act(() => mocks.onDrop!([new File(['report'], 'report.txt')]))

		expect(mocks.startUpload).not.toHaveBeenCalled()
		expect(mocks.toastError).toHaveBeenCalledWith('files-error.upload', {area: 'files'})
	})
})
