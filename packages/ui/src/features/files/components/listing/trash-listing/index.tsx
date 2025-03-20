import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {IconButtonLink} from '@/components/ui/icon-button-link'
import {FlameIcon} from '@/features/files/assets/flame-icon'
import {Listing} from '@/features/files/components/listing'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {ContextMenuItem} from '@/shadcn-components/ui/context-menu'
import {DropdownMenuItem} from '@/shadcn-components/ui/dropdown-menu'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function TrashListing() {
	const navigate = useRouterNavigate()
	const {currentPath} = useNavigate()

	const {listing, isLoading, error, fetchMoreItems} = useListDirectory(currentPath)

	const items = listing?.items || []
	const isTrashEmpty = items.length === 0

	const linkToDialog = useLinkToDialog()

	const additionalContextMenuItems = (
		<ContextMenuItem
			onClick={() => {
				navigate(linkToDialog('files-empty-trash-confirmation'))
			}}
			disabled={isTrashEmpty}
		>
			{t('files-action.empty-trash')}
		</ContextMenuItem>
	)

	const DesktopActions = (
		<IconButtonLink
			icon={FlameIcon}
			to={linkToDialog('files-empty-trash-confirmation')}
			// IconButtonLink doesn't accept disabled prop
			className={isTrashEmpty ? 'pointer-events-none opacity-60' : ''}
		>
			{t('files-action.empty-trash')}
		</IconButtonLink>
	)

	const MobileActions = (
		<DropdownMenuItem
			onClick={() => {
				navigate(linkToDialog('files-empty-trash-confirmation'))
			}}
			disabled={isTrashEmpty}
		>
			<FlameIcon className='mr-2 h-4 w-4 opacity-50' />
			{t('files-action.empty-trash')}
		</DropdownMenuItem>
	)

	return (
		<Listing
			items={items}
			selectableItems={items}
			isLoading={isLoading}
			error={error}
			hasMore={listing?.hasMore ?? false}
			onLoadMore={fetchMoreItems}
			enableFileDrop={false}
			additionalDesktopActions={DesktopActions}
			additionalMobileActions={MobileActions}
			additionalContextMenuItems={additionalContextMenuItems}
		/>
	)
}
