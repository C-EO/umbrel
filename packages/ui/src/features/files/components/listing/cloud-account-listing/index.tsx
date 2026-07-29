import {useEffect, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams, useNavigate as useRouterNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {IconButton} from '@/components/ui/icon-button'
import {CloudIcon} from '@/features/files/assets/cloud-icon'
import {CloudPlusIcon} from '@/features/files/assets/cloud-plus'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {cloudSyncName, useCloudAccounts, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import type {FileSystemItem} from '@/features/files/types'
import {useLinkToDialog} from '@/utils/dialog'

// Virtual /Cloud/<accountId> route: lists a connected account's download
// destination folders as a standard listing. Items carry their real
// destination paths, so folder badges, navigation, and the cloud
// context menu verbs all behave as in a normal directory view.
export function CloudAccountListing() {
	const {t} = useTranslation()
	const {accountId} = useParams<{accountId: string}>()
	const {data: clouds, isLoading} = useCloudSyncs()
	const {data: accounts} = useCloudAccounts()
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()
	const setActionsBarConfig = useSetActionsBarConfig()

	const account = accounts?.find(({id}) => id === accountId)

	const items = useMemo<FileSystemItem[]>(
		() =>
			(clouds ?? [])
				.filter((cloud) => cloud.accountId === accountId)
				.map((cloud) => ({
					name: cloudSyncName(cloud),
					path: cloud.destination.path,
					type: 'directory' as const,
					size: 0,
					modified: cloud.lastSuccessfulAt ?? Date.now(),
					operations: [],
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[clouds, accountId],
	)

	const openAddWizard = () => routerNavigate(linkToDialog('files-cloud-add', account ? {account: account.id} : {}))

	useEffect(() => {
		setActionsBarConfig({
			hideSearch: true,
			desktopActions: (
				<IconButton icon={CloudPlusIcon} onClick={openAddWizard}>
					{t('files-cloud.add-download')}
				</IconButton>
			),
			// Selection is meaningless on the account's destination tiles, so
			// the mobile bar offers the add action instead of the Select toggle
			mobilePrimaryAction: (
				<Button className='h-[1.9rem] rounded-full px-3 text-13' size='default' onClick={openAddWizard}>
					{t('files-cloud.add-download')}
				</Button>
			),
		})
	}, [account?.id])

	const EmptyState = () => (
		<div className='flex h-full flex-col items-center justify-center gap-3 p-4 pt-0 text-center'>
			<CloudIcon className='size-12 opacity-60' />
			<div className='text-12 text-white/40'>{t('files-cloud.account-empty')}</div>
			<IconButton icon={CloudPlusIcon} variant='primary' onClick={openAddWizard}>
				{t('files-cloud.add-download')}
			</IconButton>
		</div>
	)

	return (
		<Listing
			items={items}
			totalItems={items.length}
			selectableItems={items}
			isLoading={isLoading}
			hasMore={false}
			onLoadMore={async () => false}
			enableFileDrop={false}
			CustomEmptyView={EmptyState}
		/>
	)
}
