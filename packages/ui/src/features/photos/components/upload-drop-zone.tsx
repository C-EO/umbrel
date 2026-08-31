import type {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

import {FileDropZone} from '@/components/file-drop-zone'
import {useUpload} from '@/features/photos/hooks/use-upload'

// Files dragged from the desktop drop anywhere on the pane — every page
// except Deleted — and upload into the library; dropped on an
// album's page they join the album too (use-upload reads the route). No
// filtering here: use-upload sifts photos and videos from everything else
// and explains the rest, so nothing silently disappears.
export function UploadDropZone({children}: {children: ReactNode}) {
	const {t} = useTranslation()
	const {section} = useParams()
	const {upload} = useUpload()

	return (
		<FileDropZone
			onDrop={upload}
			label={t('photos-actions.drop-to-upload')}
			disabled={section === 'deleted'}
			// The pane paints past this wrapper's box — up under the sheet's chrome
			// (the bar's pull-up) and out to its right edge (ListingSurface's
			// margins) — so the veil follows it
			overlayClassName='lg:-top-[86px] lg:-right-10 xl:-right-[60px]'
		>
			{children}
		</FileDropZone>
	)
}
