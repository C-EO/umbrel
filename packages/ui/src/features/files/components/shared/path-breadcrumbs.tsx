import {FolderOpen} from 'lucide-react'
import {useLayoutEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {FadeScroller} from '@/components/fade-scroller'
import {CaretRightIcon} from '@/features/files/assets/caret-right'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {APPS_PATH, EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {cn} from '@/lib/utils'

type Crumb = {path: string; name: string; type: 'directory' | 'external-storage' | 'network-share'}

export function getCrumbs(path: string, homePath: string, homeName: string, appsName: string): Crumb[] {
	const segments = path.split('/').filter(Boolean)
	const crumbs: Crumb[] = []

	if (path.startsWith(`${EXTERNAL_STORAGE_PATH}/`)) {
		crumbs.push({path: `${EXTERNAL_STORAGE_PATH}/${segments[1]}`, name: segments[1], type: 'external-storage'})
		segments.slice(2).forEach((segment, i) => {
			crumbs.push({
				path: [EXTERNAL_STORAGE_PATH, segments[1], ...segments.slice(2, i + 3)].join('/'),
				name: segment,
				type: 'directory',
			})
		})
	} else if (path.startsWith(`${NETWORK_STORAGE_PATH}/`)) {
		// A bare host path (/Network/<host>) has no share segment to include
		crumbs.push({
			path: [NETWORK_STORAGE_PATH, segments[1], segments[2]].filter(Boolean).join('/'),
			name: segments[2] ?? segments[1],
			type: 'network-share',
		})
		segments.slice(3).forEach((segment, i) => {
			crumbs.push({
				path: [NETWORK_STORAGE_PATH, segments[1], segments[2], ...segments.slice(3, i + 4)].join('/'),
				name: segment,
				type: 'directory',
			})
		})
	} else if (path === APPS_PATH || path.startsWith(`${APPS_PATH}/`)) {
		// FileItemIcon resolves /Apps to the apps glyph and /Apps/<appId> to the
		// app's own icon, so app storage crumbs carry the app's identity
		crumbs.push({path: APPS_PATH, name: appsName, type: 'directory'})
		segments.slice(1).forEach((segment, i) => {
			crumbs.push({path: `/${segments.slice(0, i + 2).join('/')}`, name: segment, type: 'directory'})
		})
	} else if (path === homePath || path.startsWith(`${homePath}/`)) {
		const homeSegments = path.replace(homePath, '').split('/').filter(Boolean)
		crumbs.push({path: homePath, name: homeName, type: 'directory'})
		homeSegments.forEach((segment, i) => {
			crumbs.push({path: [homePath, ...homeSegments.slice(0, i + 1)].join('/'), name: segment, type: 'directory'})
		})
	} else {
		// Unknown root: every segment as a plain folder crumb
		segments.forEach((segment, i) => {
			crumbs.push({path: `/${segments.slice(0, i + 1).join('/')}`, name: segment, type: 'directory'})
		})
	}

	return crumbs
}

// A path rendered the way the Files path bar draws it: an icon and name per
// segment with caret separators, minus the navigation. The one shared way to
// show a folder location anywhere outside the Files browser itself.
export function PathBreadcrumbs({path, className}: {path: string; className?: string}) {
	const {t} = useTranslation()
	const homePath = useHomePath()
	const crumbs = getCrumbs(path, homePath, t('files-sidebar.home'), t('files-sidebar.apps'))
	const scrollerRef = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		if (scrollerRef.current) scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth
	}, [path])

	return (
		<FadeScroller
			ref={scrollerRef}
			direction='x'
			// The default 50px fade swallows most of a compact row (both edges fade
			// while mid-scroll), so a long path could never be read in full. A
			// shallow fade keeps the overflow affordance while scrolling either end
			// clears its fade entirely, leaving the first and last crumbs crisp.
			fadeSize={16}
			className={cn('umbrel-hide-scrollbar min-w-0 flex-1 overflow-x-auto', className)}
			title={path}
		>
			<span className='flex w-max items-center gap-1 px-0.5'>
				{crumbs.map((crumb, index) => (
					<span key={crumb.path} className='flex shrink-0 items-center gap-1'>
						<FileItemIcon
							item={{
								path: crumb.path,
								type: crumb.type,
								name: crumb.name,
								operations: [],
								size: 0,
								modified: 0,
							}}
							// Overlay badges have listing-sized minimums that overflow a
							// 16px crumb. mt-px: icons center on the line box while glyphs
							// sit on the baseline below it, so a nudge down matches the
							// text's optical center.
							showBadges={false}
							className='mt-px h-4 w-4 shrink-0 opacity-70'
						/>
						<span className='text-sm whitespace-nowrap'>{crumb.name}</span>
						{index < crumbs.length - 1 && <CaretRightIcon className='mx-0.5 mt-[1px] shrink-0 text-white/50' />}
					</span>
				))}
			</span>
		</FadeScroller>
	)
}

export const folderPickerRowClass =
	'flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3'

// A folder location in a row, optionally with an action to change it. Renders
// the whole row as the button so the target is generous, with the action
// affordance drawn as a pill inside it: "Change" when a folder is set,
// "Choose" when none is yet.
export function FolderPickerRow({
	path,
	loading = false,
	emptyLabel,
	actionLabel,
	onAction,
	disabled = false,
}: {
	path?: string | null
	loading?: boolean
	emptyLabel?: string
	actionLabel?: string
	onAction?: () => void
	disabled?: boolean
}) {
	const {t} = useTranslation()
	const content = loading ? (
		<span className='h-4 w-44 animate-pulse rounded bg-white/10' />
	) : path ? (
		<PathBreadcrumbs path={path} />
	) : (
		<span className='flex min-w-0 items-center gap-1.5 text-sm text-white/45'>
			<FolderOpen className='size-4 shrink-0 text-white/40' />
			<span className='min-w-0 truncate'>{emptyLabel}</span>
		</span>
	)

	if (!onAction) {
		return <div className={folderPickerRowClass}>{content}</div>
	}

	return (
		<button
			type='button'
			onClick={onAction}
			disabled={disabled}
			className={cn(
				folderPickerRowClass,
				'text-left transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-60',
			)}
		>
			{content}
			<span className='inline-flex h-[25px] shrink-0 items-center rounded-full border-[0.5px] border-white/20 bg-white/10 px-[10px] text-12 font-medium text-white shadow-button-highlight-soft-hpx transition-colors hover:bg-white/15'>
				{actionLabel ?? (path && !loading ? t('files-path-picker.change') : t('files-path-picker.choose'))}
			</span>
		</button>
	)
}
