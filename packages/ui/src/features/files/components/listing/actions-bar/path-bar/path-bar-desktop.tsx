import {useCallback, useLayoutEffect, useMemo, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {FadeScroller} from '@/components/fade-scroller'
import {CaretRightIcon} from '@/features/files/assets/caret-right'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {
	APPS_PATH,
	CLOUD_PATH,
	EXTERNAL_STORAGE_PATH,
	MACHINES_PATH,
	NETWORK_STORAGE_PATH,
	RECENTS_PATH,
	SYSTEM_MANAGED_ROOT_PATHS,
} from '@/features/files/constants'
import {cloudAccountLabel, useCloudAccounts, useCloudProviders} from '@/features/files/hooks/use-cloud'
import {useHomePath, useIsMember, useTrashPath} from '@/features/files/hooks/use-home-path'
import {useMachineFolder} from '@/features/files/hooks/use-machine-folder'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'
import {firstNameFromFullName} from '@/utils/misc'

type PathSegment = {
	id: number
	path: string
	segment: string
	type:
		| 'home'
		| 'trash'
		| 'recents'
		| 'apps'
		| 'machines'
		| 'folder'
		| 'external-storage'
		| 'network-root'
		| 'network-share'
		| 'cloud-account'
}

export function PathBarDesktop({path}: {path: string}) {
	const {t} = useTranslation()
	// Ref for the list element that handles width calculations and overflow behavior for path segments
	const breadcrumbsRef = useRef<HTMLUListElement | null>(null)

	// Ref for the scrollable container that handles horizontal scrolling and fade effect
	const fadeScrollerRef = useRef<HTMLDivElement | null>(null)

	const {navigateToDirectory, isBrowsingExternalStorage, isBrowsingNetworkStorage, uiPath} = useNavigate()

	// Account label for the virtual /Cloud/<accountId> route
	const isUiCloudRoot = uiPath === CLOUD_PATH
	const isUiCloudAccount = uiPath.startsWith(`${CLOUD_PATH}/`)
	const {data: cloudAccounts} = useCloudAccounts({enabled: isUiCloudAccount})
	const {data: cloudProviders} = useCloudProviders({enabled: isUiCloudAccount})

	// The current account's home and trash roots (owner: /Home and /Trash,
	// member: /Users/<slug> and /Users/<slug>/Trash) so a member's breadcrumb
	// roots at their own home rather than rendering unnavigable segments
	const homePath = useHomePath()
	const trashPath = useTrashPath()

	// For members browsing the owner's files (via paths shared with them), the
	// breadcrumb roots at "{Owner}'s Umbrel" (/Home), mirroring their sidebar
	const isMember = useIsMember()
	const {sharedWithMe} = useMemberShares()
	const ownersUmbrelName = sharedWithMe?.ownerName
		? t('files-sidebar.owners-umbrel', {name: firstNameFromFullName(sharedWithMe.ownerName)})
		: ''

	const segments = useMemo(() => {
		// Display path: derive from UI path to hide backups/snapshot segments
		const displayPath = uiPath

		// Determine root type and path from UI path
		const isUiTrash = displayPath.startsWith(trashPath)
		const isUiRecents = displayPath.startsWith(RECENTS_PATH)
		const isUiApps = displayPath.startsWith(APPS_PATH)
		const isUiMachines = displayPath.startsWith(MACHINES_PATH)
		const isUiNetwork = displayPath.startsWith(NETWORK_STORAGE_PATH)
		const isUiExternal = displayPath.startsWith(EXTERNAL_STORAGE_PATH)

		const displaySegments = displayPath.split('/').filter(Boolean)

		// Members browsing the owner's home root at "{Owner}'s Umbrel"
		const isOwnersUmbrel = isMember && (displayPath === '/Home' || displayPath.startsWith('/Home/'))

		const rootInfo = isOwnersUmbrel
			? {
					segment: ownersUmbrelName,
					type: 'home' as const,
					path: '/Home',
				}
			: isUiTrash
				? {segment: t('files-sidebar.trash'), type: 'trash' as const, path: trashPath}
				: isUiRecents
					? {segment: t('files-sidebar.recents'), type: 'recents' as const, path: RECENTS_PATH}
					: isUiApps
						? {segment: t('files-sidebar.apps'), type: 'apps' as const, path: APPS_PATH}
						: isUiMachines
							? {segment: t('machines'), type: 'machines' as const, path: MACHINES_PATH}
							: isUiCloudRoot || isUiCloudAccount
								? {segment: t('files-sidebar.cloud'), type: 'cloud-account' as const, path: CLOUD_PATH}
								: isUiExternal
									? {
											segment: displaySegments[1] || t('files-sidebar.external-storage'),
											type: 'external-storage' as const,
											path: `${EXTERNAL_STORAGE_PATH}/${displaySegments[1] || ''}`,
										}
									: isUiNetwork
										? {
												segment: displayPath === NETWORK_STORAGE_PATH ? t('files-sidebar.network-pathbar') : '',
												type: 'network-root' as const,
												path: NETWORK_STORAGE_PATH,
											}
										: {segment: t('files-sidebar.home'), type: 'home' as const, path: homePath}

		// Start with the root segment
		const items: PathSegment[] = [
			{
				id: 0,
				...rootInfo,
			},
		]

		// Add nested folder segments
		const nestedDisplayPaths = isBrowsingExternalStorage
			? displayPath.split('/').slice(3).filter(Boolean) // Skip external-storage and disk name
			: displayPath.replace(rootInfo.path, '').split('/').filter(Boolean)

		nestedDisplayPaths.forEach((segment, i) => {
			const segmentUiPath = [rootInfo.path, ...nestedDisplayPaths.slice(0, i + 1)].join('/')

			// Determine the type for the segment
			let segmentType: PathSegment['type'] = 'folder'
			let segmentLabel = segment

			// First level network share gets network-share type for NAS icon
			if (isBrowsingNetworkStorage && i === 0) {
				segmentType = 'network-share'
			}

			// First level cloud segment is the account: provider logo + account label
			if (isUiCloudAccount && i === 0) {
				segmentType = 'cloud-account'
				const account = cloudAccounts?.find(({id}) => id === segment)
				if (account) segmentLabel = cloudAccountLabel(account, cloudAccounts, cloudProviders)
			}

			items.push({
				id: i + 1,
				type: segmentType,
				segment: segmentLabel,
				path: segmentUiPath,
			})
		})

		return items
	}, [
		uiPath,
		homePath,
		trashPath,
		isMember,
		ownersUmbrelName,
		isBrowsingExternalStorage,
		isBrowsingNetworkStorage,
		isUiCloudRoot,
		isUiCloudAccount,
		cloudAccounts,
		cloudProviders,
	])

	const deriveIsOverflow = useCallback(() => {
		if (!breadcrumbsRef.current) return

		const children = Array.from(breadcrumbsRef.current.children).filter(
			(i): i is HTMLElement => i instanceof HTMLElement,
		)

		// Reset children inline styles
		children.forEach((child) => {
			child.style.removeProperty('--natural-width')
			child.style.removeProperty('--item-width')
			child.classList.remove('has-overflow')
		})

		let availableWidth = breadcrumbsRef.current.clientWidth

		// Subtract space for the static elements
		children
			.filter((child) => child.dataset.static)
			.forEach((child) => {
				availableWidth -= child.getBoundingClientRect().width
			})

		let remainingSpace = availableWidth
		let totalUsedWidth = 0

		children
			.filter((child) => !child.dataset.static)
			.forEach((child, i, filteredChildren) => {
				const naturalWidth = child.clientWidth
				const collapsibleCount = filteredChildren.length

				// Calculate proportional width for the current child
				const proportionalWidth = remainingSpace / (collapsibleCount - i)

				// Determine the final width for the child
				const width = naturalWidth > proportionalWidth ? proportionalWidth : naturalWidth

				// Update total used width and remaining space
				totalUsedWidth += width
				remainingSpace = availableWidth - totalUsedWidth

				if (naturalWidth > proportionalWidth) {
					child.classList.add('has-overflow')
				}

				child.style.setProperty('--natural-width', `${Math.round(naturalWidth)}px`)
				child.style.setProperty('--item-width', `${Math.round(width)}px`)
			})
	}, [])

	useLayoutEffect(() => {
		if (!breadcrumbsRef.current) return

		const resizeObserver = new ResizeObserver(deriveIsOverflow)
		resizeObserver.observe(breadcrumbsRef.current)

		deriveIsOverflow()

		// Auto-scroll to the right after widths are calculated
		requestAnimationFrame(() => {
			if (fadeScrollerRef.current) {
				fadeScrollerRef.current.scrollLeft = fadeScrollerRef.current.scrollWidth
			}
		})

		return () => {
			resizeObserver.disconnect()
		}
	}, [deriveIsOverflow, path])

	return (
		<FadeScroller direction='x' className='umbrel-hide-scrollbar overflow-x-auto' ref={fadeScrollerRef}>
			<ul className='flex h-8 items-center border border-transparent py-1 whitespace-nowrap' ref={breadcrumbsRef}>
				{segments.map((segment, i) => {
					/* First and last two segments are static, they always be fully visible */
					const isStatic = i === 0 || i > segments.length - 3 ? true : undefined

					return (
						<PathSegment
							key={segment.id}
							type={segment.type}
							segment={segment.segment}
							hasArrow={i < segments.length - 1}
							onClick={() => navigateToDirectory(segment.path)}
							path={segment.path}
							isStatic={isStatic}
						/>
					)
				})}
			</ul>
		</FadeScroller>
	)
}

type PathSegmentProps = Omit<PathSegment, 'id'> & {
	hasArrow: boolean
	onClick: () => void
	isStatic?: boolean
}

const PathSegment = ({segment, hasArrow, onClick, isStatic, path, type}: PathSegmentProps) => {
	// A machine's directory is named by its id; show the machine's name like the listing does
	const {machine} = useMachineFolder(path)
	const label = machine ? machine.name : segment && formatItemName({name: segment})

	return (
		<li className='inline-flex' data-static={isStatic}>
			<Droppable
				as='button'
				id={`path-segment-${path}`}
				path={path}
				onClick={onClick}
				// Nothing can be dropped into a system-managed root (/Apps, /Machines)
				disabled={SYSTEM_MANAGED_ROOT_PATHS.has(path)}
				className={cn(
					'group inline-flex w-[--item-width] min-w-[42px] items-center gap-1 rounded-sm p-1 transition-[width] duration-300 ease-in-out hover:w-[--natural-width]',
					focusRingClass,
				)}
			>
				<FileItemIcon
					item={{
						path,
						type:
							type === 'external-storage'
								? 'external-storage'
								: type === 'network-root'
									? 'network-root'
									: type === 'network-share'
										? 'network-share'
										: type === 'cloud-account'
											? 'cloud-account'
											: 'directory',
						name: segment,
						operations: [],
						size: 0,
						modified: 0,
					}}
					className='h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100'
				/>
				<span
					className={cn(
						'group-hover:[mask-image:none] [.has-overflow_&]:[mask-image:linear-gradient(to_left,transparent_0%,black_40px)]',
						'overflow-hidden text-xs opacity-70 transition-opacity group-hover:opacity-100',
						label && 'ml-1',
					)}
				>
					{label}
				</span>
				{hasArrow && <CaretRightIcon className='mt-[1px] ml-1 shrink-0 text-white/50' />}
			</Droppable>
		</li>
	)
}
