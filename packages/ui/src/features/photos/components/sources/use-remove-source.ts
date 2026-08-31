import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {sectionPath} from '@/features/photos/constants'
import {usePhotoSourceActions, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {formatNumberI18n} from '@/utils/number'

// Two-step, explicit removal shared by the sidebar menu, the overview tiles and
// the details dialog: stop importing and keep the items (default), or take the
// items out of Photos too. Originals on the device are never touched.
export function useRemoveSource() {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()
	const navigate = useNavigate()
	const {removeSource, isRemoving} = usePhotoSourceActions()

	const remove = async (source: PhotoSource, {navigateAway = false} = {}) => {
		try {
			const {actionValue} = await confirm({
				title: t('photos-source.remove-title', {name: source.name}),
				message: t('photos-source.remove-message', {
					count: source.stats.photos + source.stats.videos,
					formattedCount: formatNumberI18n({
						n: source.stats.photos + source.stats.videos,
						showDecimals: false,
						locale: i18n.language,
					}),
				}),
				actions: [
					{label: t('photos-source.remove-keep-items'), value: 'keep', variant: 'primary'},
					{label: t('photos-source.remove-with-items'), value: 'remove-items', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (actionValue === 'cancel') return false
			await removeSource({id: source.id, keepItems: actionValue === 'keep'})
			if (navigateAway) navigate(sectionPath('sources'))
			return true
		} catch {
			return false
		}
	}

	return {remove, isRemoving}
}
