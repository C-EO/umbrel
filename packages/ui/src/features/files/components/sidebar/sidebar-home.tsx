import {useTranslation} from 'react-i18next'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {useHomePath, useIsMember} from '@/features/files/hooks/use-home-path'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useShares} from '@/features/files/hooks/use-shares'
import {useQueryParams} from '@/hooks/use-query-params'
import {useHasMembers} from '@/modules/user-sharing'

export function SidebarHome() {
	const {t} = useTranslation()
	const homeDirectoryName = useHomeDirectoryName()
	const homePath = useHomePath()
	const isMember = useIsMember()
	const {navigateToDirectory, currentPath} = useNavigate()
	const navigate = useRouterNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const {isHomeShared} = useShares()
	const hasMembers = useHasMembers()

	const isShared = isHomeShared()

	const openShareInfoDialog = () => {
		navigate({
			search: addLinkSearchParams({
				dialog: 'files-share-info',
				'files-share-info-name': homeDirectoryName,
				'files-share-info-path': homePath,
			}),
		})
	}

	// Share the owner's entire Umbrel (/Home) with member accounts
	const openShareUsersDialog = () => {
		navigate({
			search: addLinkSearchParams({
				dialog: 'files-share-users',
				'files-share-users-name': homeDirectoryName,
				'files-share-users-path': homePath,
			}),
		})
	}

	const homeItem = (
		<SidebarItem
			item={{
				name: homeDirectoryName,
				path: homePath,
				type: 'directory',
			}}
			isActive={currentPath === homePath}
			onClick={() => navigateToDirectory(homePath)}
		/>
	)

	// Sharing is owner-only, members get the plain item without the share menu
	if (isMember) return homeItem

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div>{homeItem}</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={openShareInfoDialog}>
					{isShared ? t('files-action.sharing') : t('files-action.share')}
				</ContextMenuItem>
				{hasMembers && (
					<ContextMenuItem onClick={openShareUsersDialog}>{t('files-action.share-with-users')}</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
}
