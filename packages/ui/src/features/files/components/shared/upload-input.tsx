import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useGlobalFiles} from '@/providers/global-files'

export function UploadInput({ref, disabled = false}: {ref?: React.Ref<HTMLInputElement>; disabled?: boolean}) {
	const {startUpload} = useGlobalFiles()
	const {currentPath} = useNavigate()
	const isReadOnly = useIsFilesReadOnly()

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (disabled || isReadOnly) return
		if (e.target.files && e.target.files.length > 0) {
			startUpload(e.target.files, currentPath)
			e.target.value = ''
		}
	}
	return (
		<input
			type='file'
			ref={ref}
			style={{display: 'none'}}
			multiple
			accept='*'
			disabled={disabled || isReadOnly}
			onChange={handleFileChange}
		/>
	)
}
