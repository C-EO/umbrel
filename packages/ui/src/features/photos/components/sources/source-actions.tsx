import {Ellipsis} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {usePhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {useLinkToDialog} from '@/utils/dialog'

// A source page's own actions in the bar: Manage (the details dialog). Import
// now returns with the post-v1 source types that can go stale (drives, shares).
export function SourceActions({sourceId}: {sourceId: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const {source} = usePhotoSource(sourceId)
	if (!source) return null
	return (
		// The same "⋯" that manages a source everywhere else (sidebar, tiles)
		<PillButton
			icon={Ellipsis}
			aria-label={t('photos-source.manage')}
			onClick={() => navigate(linkToDialog('photos-source', {id: source.id}))}
		/>
	)
}
