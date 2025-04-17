import React, {useEffect, useState} from 'react'
import {BsTrash2} from 'react-icons/bs'
import {IoPlay} from 'react-icons/io5'

import {AppsIcon} from '@/features/files/assets/apps-icon'
import {ExternalStorageIcon} from '@/features/files/assets/external-storage-icon'
import {HomeIcon} from '@/features/files/assets/home-icon'
import {RecentsIcon} from '@/features/files/assets/recents-icon'
import {SharedFolderBadge} from '@/features/files/assets/shared-folder-badge'
import {AnimatedFolderIcon} from '@/features/files/components/shared/file-item-icon/animated-folder-icon'
import {
	DocumentsIcon,
	DownloadsIcon,
	PhotosIcon,
	VideosIcon,
} from '@/features/files/components/shared/file-item-icon/embedded-overlay-icons'
import {FolderIcon as SimpleFolderIcon} from '@/features/files/components/shared/file-item-icon/folder-icon'
import {UnknownFileThumbnail} from '@/features/files/components/shared/file-item-icon/unknown-file-thumbnail'
import {
	APPS_PATH,
	FILE_TYPE_MAP,
	HOME_PATH,
	IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS,
	RECENTS_PATH,
	TRASH_PATH,
	VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS,
} from '@/features/files/constants'
import {useShares} from '@/features/files/hooks/use-shares'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {trpcReact} from '@/trpc/trpc'

interface FileItemIcon {
	item: FileSystemItem
	onlySVG?: boolean
	className?: string
	useAnimatedIcon?: boolean
	isHovered?: boolean
}

export const FileItemIcon = ({item, onlySVG, className, useAnimatedIcon = false, isHovered = false}: FileItemIcon) => {
	const {isPathShared} = useShares()
	const isShared = isPathShared(item.path)

	const isAppFolder =
		item.path.startsWith(APPS_PATH) &&
		// check if it's not a nested app directory, eg. we want to return true for /Apps/bitcoin but false for /Apps/bitcoin/data
		item.path.slice(APPS_PATH.length).split('/').length === 2

	// External storage icon if the user directly navigates to umbrel.local/files/External
	if (item.type === 'directory' && isDirectoryAnExternalDrivePartition(item.path)) {
		return <ExternalStorageIcon className={className} />
	}

	// External storage for sidebar and pathbar
	if (item.type === 'external-storage') {
		return <ExternalStorageIcon className={className} />
	}

	// Folder
	if (item.type === 'directory') {
		if (onlySVG) {
			return <SimpleFolderIcon className={className} />
		}

		return (
			<div className='relative'>
				<FolderIcon className={className} path={item.path} useAnimatedIcon={useAnimatedIcon} isHovered={isHovered} />
				{isAppFolder ? <AppFolderBottomIcon appId={item.path.split(APPS_PATH).pop() || ''} /> : null}

				{/* we add it here because only folders can be shared */}
				{isShared ? (
					<div className='absolute left-0 top-0 flex h-1/2 max-h-8 min-h-[0.9rem] w-1/2 min-w-[0.9rem] max-w-8 translate-x-[-30%] translate-y-[-20%] items-center justify-center rounded-full border border-white/15 bg-gradient-to-b from-brand to-[color-mix(in_srgb,hsl(var(--color-brand))_80%,black_20%)] shadow-md'>
						<SharedFolderBadge className='h-[80%] w-[80%]' />
					</div>
				) : null}
			</div>
		)
	}

	// Unknown file
	if (
		!item.type ||
		!FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP] ||
		!FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP].thumbnail
	) {
		return <UnknownFileThumbnail type={item.type || ''} className={className} />
	}

	// Get the thumbnail component
	const Thumbnail = FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP].thumbnail as React.ComponentType<{
		className?: string
	}>

	const {extension} = splitFileName(item.name)
	// Image file
	if (extension && IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS.has(extension.toLowerCase())) {
		return <ImageThumbnail item={item} fallback={Thumbnail} className={className} />
	}

	// Video file
	if (extension && VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS.has(extension.toLowerCase())) {
		return <VideoThumbnail item={item} fallback={Thumbnail} className={className} />
	}

	// All other supported file types
	return <Thumbnail className={className} />
}

const FolderIcon = ({
	className = '',
	path,
	useAnimatedIcon,
	isHovered = false,
}: {
	className?: string
	path: string
	useAnimatedIcon: boolean
	isHovered?: boolean
}) => {
	if (path === HOME_PATH) {
		return <HomeIcon className={className} />
	}
	if (path === TRASH_PATH) {
		return <BsTrash2 className={className} />
	}
	if (path === RECENTS_PATH) {
		return <RecentsIcon className={className} />
	}
	if (path === APPS_PATH) {
		return <AppsIcon className={className} />
	}

	const FolderComponent = useAnimatedIcon ? AnimatedFolderIcon : SimpleFolderIcon

	if (path === `${HOME_PATH}/Videos`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={VideosIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={VideosIcon} />
		)
	}
	if (path === `${HOME_PATH}/Downloads`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={DownloadsIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={DownloadsIcon} />
		)
	}
	if (path === `${HOME_PATH}/Documents`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={DocumentsIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={DocumentsIcon} />
		)
	}
	if (path === `${HOME_PATH}/Photos`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={PhotosIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={PhotosIcon} />
		)
	}
	return useAnimatedIcon ? (
		<FolderComponent className={className} isHovered={isHovered} />
	) : (
		<FolderComponent className={className} />
	)
}

const AppFolderBottomIcon = ({appId}: {appId: string}) => {
	const [error, setError] = useState(false)
	const [loaded, setLoaded] = useState(false)

	return (
		<img
			onError={() => setError(true)}
			onLoad={() => setLoaded(true)}
			src={`https://getumbrel.github.io/umbrel-apps-gallery/${appId}/icon.svg`}
			alt={appId}
			className={`absolute bottom-0 right-0 flex h-1/2 max-h-8 min-h-5 w-1/2 min-w-5 max-w-8 translate-x-[16%] translate-y-[10%] items-center justify-center overflow-hidden rounded-[25%] border border-white/15 object-contain shadow-md md:min-h-[0.9rem] md:min-w-[0.9rem] ${
				!loaded || error ? 'opacity-0' : 'opacity-100'
			}`}
		/>
	)
}

// Thumbnail component with on‑demand fetch + exponential backoff
function useOnDemandThumbnail(item: FileSystemItem) {
	const MAX_RETRIES = 4 // limit at 4 times, to not continually spam umbreld with on-demand thumnail requests if they error because it could be an ImageMagick error and we'd be continually spawning convert processes (in a queue)
	const INITIAL_DELAY_MS = 500 // wait for 500ms to begin with

	const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(item.thumbnail)
	const [attempt, setAttempt] = useState(0)

	const getThumbnailMutation = trpcReact.files.getThumbnail.useMutation()

	// Reset when file changes
	useEffect(() => {
		setThumbnailUrl(item.thumbnail)
		setAttempt(0)
	}, [item.path, item.thumbnail])

	// Fetch with exponential backoff
	useEffect(() => {
		if (thumbnailUrl || attempt > MAX_RETRIES) return

		const delay = INITIAL_DELAY_MS * 2 ** attempt
		const timer = setTimeout(() => {
			getThumbnailMutation
				.mutateAsync({path: item.path})
				.then(setThumbnailUrl)
				.catch(() => setAttempt((a) => a + 1))
		}, delay)

		return () => clearTimeout(timer)
	}, [thumbnailUrl, attempt, item.path])

	const handleImageError = () => {
		setThumbnailUrl(undefined)
		setAttempt((a) => a + 1)
	}

	return {thumbnailUrl, handleImageError}
}

const Thumbnail = ({
	item,
	fallback: Fallback,
	className,
	overlay,
}: {
	item: FileSystemItem
	fallback: React.ComponentType<{className?: string}>
	className?: string
	overlay?: React.ReactNode
}) => {
	const {thumbnailUrl, handleImageError} = useOnDemandThumbnail(item)

	if (!thumbnailUrl) {
		return <Fallback className={className} />
	}

	const imageElement = (
		<img
			src={thumbnailUrl}
			alt={item.name}
			onError={handleImageError}
			className={`rounded-sm object-contain ${className || ''}`}
		/>
	)

	if (!overlay) return imageElement

	return (
		<div className='relative'>
			{imageElement}
			{overlay}
		</div>
	)
}

// Image thumbnail
const ImageThumbnail = (props: {
	item: FileSystemItem
	fallback: React.ComponentType<{className?: string}>
	className?: string
}) => <Thumbnail {...props} />

// Video thumbnail
const VideoThumbnail = ({
	item,
	fallback,
	className,
}: {
	item: FileSystemItem
	fallback: React.ComponentType<{className?: string}>
	className?: string
}) => (
	<Thumbnail
		item={item}
		fallback={fallback}
		className={className}
		overlay={
			<div className='absolute left-1/2 top-1/2 flex h-full w-full -translate-x-1/2 -translate-y-1/2 items-center justify-center'>
				<IoPlay className='h-1/3 w-1/3 text-white shadow-md' />
			</div>
		}
	/>
)
