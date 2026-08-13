import React, {CSSProperties} from 'react'
import {useDropzone} from 'react-dropzone'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {cn} from '@/lib/utils'
import {useGlobalFiles} from '@/providers/global-files'
import {trpcReact} from '@/trpc/trpc'

interface FileUploadDropZoneProps {
	children: React.ReactNode
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

	const {getRootProps, getInputProps, isDragActive} = useDropzone({
		onDrop,
		noClick: true,
		noKeyboard: true,
		disabled: isReadOnly,
	})

	return (
		<div {...getRootProps()} className='relative h-full'>
			<input {...getInputProps()} />
			{children}
			{isDragActive && <DropOverlay />}
		</div>
	)
}

const DropOverlay = () => {
	const {t} = useTranslation()
	return (
		<div className='absolute inset-0 flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-12 border-2 border-[hsl(var(--color-brand))]/30 bg-black/50'>
			<span className='z-10 text-center text-5xl font-medium tracking-tighter whitespace-pre-wrap text-white'>
				{t('files-action.drop-to-upload')}
			</span>
			<Ripple />
		</div>
	)
}

interface RippleProps {
	mainCircleSize?: number
	mainCircleOpacity?: number
	numCircles?: number
	className?: string
}

const Ripple = React.memo(function Ripple({
	mainCircleSize = 210,
	mainCircleOpacity = 0.24,
	numCircles = 8,
	className,
}: RippleProps) {
	return (
		<div
			className={cn(
				'pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,white,transparent)]',
				className,
			)}
		>
			{Array.from({length: numCircles}, (_, i) => {
				const size = mainCircleSize + i * 70
				const opacity = mainCircleOpacity - i * 0.03
				const animationDelay = `${i * 0.06}s`
				const borderStyle = i === numCircles - 1 ? 'dashed' : 'solid'
				const borderOpacity = 5 + i * 5

				return (
					<div
						key={i}
						className={`absolute animate-files-drop-zone-ripple rounded-full border bg-brand/25 shadow-xl [--i:${i}]`}
						style={
							{
								width: `${size}px`,
								height: `${size}px`,
								opacity,
								animationDelay,
								borderStyle,
								borderWidth: '1px',
								borderColor: `hsl(var(--brand), ${borderOpacity / 100})`,
								top: '50%',
								left: '50%',
								transform: 'translate(-50%, -50%) scale(1)',
							} as CSSProperties
						}
					/>
				)
			})}
		</div>
	)
})
