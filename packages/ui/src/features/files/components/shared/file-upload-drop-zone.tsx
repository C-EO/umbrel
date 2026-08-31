import type {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {FileDropZone} from '@/components/file-drop-zone'
import {toast} from '@/components/ui/toast'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {useGlobalFiles} from '@/providers/global-files'
import {trpcReact} from '@/trpc/trpc'

interface FileUploadDropZoneProps {
	children: ReactNode
}

export function FileUploadDropZone({children}: FileUploadDropZoneProps) {
	const {startUpload} = useGlobalFiles()
	const {currentPath} = useNavigate()
	const isReadOnly = useIsFilesReadOnly()
	const utils = trpcReact.useUtils()
	const {t} = useTranslation()

	const onDrop = async (acceptedFiles: File[]) => {
		if (isReadOnly) return
		const destination = currentPath
		try {
			const operations = await utils.files.pathOperations.fetch({path: destination})
			if (!operations.includes('writable')) throw new Error('[operation-not-allowed]')
			startUpload(acceptedFiles, destination)
		} catch (error) {
			const message = error instanceof Error ? error.message : '[operation-not-allowed]'
			toast.error(t('files-error.upload', {message: getFilesErrorMessage(message)}), {area: 'files'})
		}
	}

	return (
		<FileDropZone onDrop={onDrop} label={t('files-action.drop-to-upload')} disabled={isReadOnly}>
			{children}
		</FileDropZone>
	)
}
