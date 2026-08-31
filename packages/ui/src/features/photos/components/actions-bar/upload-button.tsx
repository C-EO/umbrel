import {Upload} from 'lucide-react'
import {useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {PillButton} from '@/components/ui/edge-controls'
import {useUpload} from '@/features/photos/hooks/use-upload'
import {useBreakpoint} from '@/utils/tw'

// The Upload pill: a hidden file picker into the shared upload queue — on an
// album's page straight into the album (use-upload reads the route). Progress,
// pause and cancel live in the floating island; picking more files while a
// run is going simply adds them to it. The word fits only where the bar has
// room to spare (xl); below that — and wherever a caller asks — the icon
// speaks for it.
export function UploadButton({iconOnly = false}: {iconOnly?: boolean}) {
	const {t} = useTranslation()
	const inputRef = useRef<HTMLInputElement>(null)
	const {upload} = useUpload()
	const breakpoint = useBreakpoint()
	const withLabel = !iconOnly && (breakpoint === 'xl' || breakpoint === '2xl')

	const onFiles = (files: FileList | null) => {
		if (!files?.length) return
		upload(files)
		if (inputRef.current) inputRef.current.value = ''
	}

	return (
		<>
			<input
				ref={inputRef}
				type='file'
				multiple
				accept='image/*,video/*'
				className='hidden'
				onChange={(e) => onFiles(e.target.files)}
			/>
			<PillButton
				icon={Upload}
				aria-label={withLabel ? undefined : t('photos-actions.upload')}
				onClick={() => inputRef.current?.click()}
			>
				{withLabel ? t('photos-actions.upload') : null}
			</PillButton>
		</>
	)
}
