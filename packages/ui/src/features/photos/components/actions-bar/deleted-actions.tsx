import {Trash2} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {PillButton} from '@/components/ui/edge-controls'
import {toast} from '@/components/ui/toast'
import {useItemActions} from '@/features/photos/hooks/use-items'
import {useLibrarySummary} from '@/features/photos/hooks/use-library'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'

export function DeletedActions({iconOnly = false}: {iconOnly?: boolean}) {
	const {t} = useTranslation()
	const confirm = useConfirmation()
	const {deletePermanently} = useItemActions()
	const {data: summary} = useLibrarySummary()
	const purgeAll = async () => {
		const result = await confirm({
			title: t('photos-deleted.delete-all-title'),
			message: t('photos-deleted.delete-all-message'),
			actions: [
				{label: t('photos-item.delete-permanently'), value: 'delete', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).catch(() => undefined)
		if (result?.actionValue !== 'delete') return
		await deletePermanently({}).catch(() => toast.error(t('photos-selection.failed'), {area: 'photos'}))
	}

	return (
		<PillButton
			icon={Trash2}
			aria-label={iconOnly ? t('photos-deleted.delete-all') : undefined}
			disabled={!summary?.counts.deleted}
			onClick={purgeAll}
		>
			{iconOnly ? null : t('photos-deleted.delete-all')}
		</PillButton>
	)
}
