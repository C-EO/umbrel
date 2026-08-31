import {FolderPlus} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {toast} from '@/components/ui/toast'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {BASE_ROUTE_PATH} from '@/features/photos/constants'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {useBreakpoint} from '@/utils/tw'

// What the actions bar offers while items are being picked for an album,
// on every page (the picking follows the user around the library): add
// what has been picked to the album, or cancel. Either way the flow ends
// on the album's page — with the items, or as it was. Below lg the button
// says just "Add": the title already counts the picks, and the name would
// crowd the zoom controls.
export function PickingActions({albumId}: {albumId: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const selection = usePhotosSelection()
	const {addToAlbum} = useAlbumActions()
	const {data: albums} = useAlbums()
	const breakpoint = useBreakpoint()
	const [busy, setBusy] = useState(false)
	const album = albums?.find((candidate) => candidate.id === albumId)
	const label =
		album && breakpoint !== 'sm' && breakpoint !== 'md'
			? t('photos-album.add-to', {album: album.name})
			: t('photos-album.add')

	const finish = () => {
		selection.done()
		navigate(`${BASE_ROUTE_PATH}/albums/${albumId}`)
	}
	const add = async () => {
		setBusy(true)
		try {
			await addToAlbum({id: albumId, ids: [...selection.ids]})
			finish()
		} catch {
			toast.error(t('photos-selection.failed'), {area: 'photos'})
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<PillButton icon={FolderPlus} disabled={selection.ids.size === 0 || busy} onClick={add}>
				{label}
			</PillButton>
			<PillButton onClick={finish}>{t('cancel')}</PillButton>
		</>
	)
}
