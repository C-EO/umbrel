import {useTranslation} from 'react-i18next'

import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {CLOUD_PATH} from '@/features/files/constants'
import {cloudAccountLabel, useCloudAccounts, useCloudProviders} from '@/features/files/hooks/use-cloud'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'

interface PathBarMobileProps {
	path: string
}

export function PathBarMobile({path}: PathBarMobileProps) {
	const {t} = useTranslation()
	const isEmbedded = useIsFilesEmbedded()
	const homePath = useHomePath()
	const {
		isInHome,
		isBrowsingRecents,
		isBrowsingTrash,
		isBrowsingExternalStorage,
		isViewingNetworkDevices,
		isBrowsingNetworkStorage,
		isBrowsingBackups,
		uiPath,
	} = useNavigate()

	// Use UI path for display so backups/snapshot segments are hidden
	const displayPath = uiPath
	const segments = displayPath.replace(homePath, '').split('/').filter(Boolean)
	const externalStorageDiskName = isBrowsingExternalStorage ? segments[1] : null
	const networkHostName = isBrowsingNetworkStorage && !isViewingNetworkDevices ? segments[1] : null

	// Virtual /Cloud/<accountId> route shows the account label, not the id
	const isCloudRoot = displayPath === CLOUD_PATH
	const isCloudAccount = displayPath.startsWith(`${CLOUD_PATH}/`)
	const {data: cloudAccounts} = useCloudAccounts({enabled: isCloudAccount})
	const {data: cloudProviders} = useCloudProviders({enabled: isCloudAccount})
	const cloudAccount = isCloudAccount ? cloudAccounts?.find(({id}) => id === segments[1]) : undefined
	const cloudAccountName = isCloudAccount
		? cloudAccount
			? cloudAccountLabel(cloudAccount, cloudAccounts, cloudProviders)
			: t('files-sidebar.cloud')
		: null

	return (
		<div className='flex min-w-0 items-center gap-1.5'>
			<FileItemIcon
				item={{
					path: isBrowsingNetworkStorage
						? (() => {
								// So for eg. if path is /Network/samba.orb.local/Documents, we want to return /Network/samba.orb.local
								//  otherwise the inactive NAS icon will be rendered
								const parts = path.split('/')
								// ['', 'Network', 'samba.orb.local', ...]
								if (parts.length >= 3) {
									return `/${parts[1]}/${parts[2]}`
								}
								return path
							})()
						: path,
					type: isBrowsingExternalStorage
						? 'external-storage'
						: isViewingNetworkDevices
							? 'network-root'
							: isBrowsingNetworkStorage
								? 'network-share'
								: isCloudAccount || isCloudRoot
									? 'cloud-account'
									: 'directory',
					name: isEmbedded
						? segments[segments.length - 1] || t('files-sidebar.home')
						: isBrowsingBackups
							? t('backups')
							: segments[segments.length - 1] || t('files-sidebar.home'),
					operations: [],
					size: 0,
					modified: 0,
				}}
				className='h-5 w-5 shrink-0'
			/>
			{/* Long labels (e.g. a WebDAV account's user · host) truncate instead of wrapping */}
			<span className='min-w-0 truncate text-13'>
				{isBrowsingTrash ? t('files-sidebar.trash') : ''}
				{isBrowsingRecents ? t('files-sidebar.recents') : ''}
				{isInHome ? t('files-sidebar.home') : ''}
				{isEmbedded ? '' : isBrowsingBackups ? t('backups') : ''}
				{isBrowsingExternalStorage ? externalStorageDiskName || t('files-sidebar.external-storage') : ''}
				{isViewingNetworkDevices ? t('files-sidebar.network-pathbar') : ''}
				{isBrowsingNetworkStorage && !isViewingNetworkDevices ? networkHostName : ''}
				{isCloudRoot ? t('files-sidebar.cloud') : ''}
				{isCloudAccount ? cloudAccountName : ''}
				{!isBrowsingTrash &&
				!isBrowsingRecents &&
				!isInHome &&
				!isBrowsingExternalStorage &&
				!isBrowsingNetworkStorage &&
				!isCloudRoot &&
				!isCloudAccount
					? `${formatItemName({name: segments[segments.length - 1] || t('files-sidebar.home')})}`
					: ''}
			</span>
		</div>
	)
}
