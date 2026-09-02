import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import type {FolderStorageApp} from '@/features/files/hooks/use-app-storage-folder-tags'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// Two icons at most; anything beyond folds into a "+N" slot so the stack keeps
// one glanceable width beside any folder name.
const MAX_ICONS = 2
// The tooltip names up to three apps before folding the rest into a count, but
// never hides a single app behind "1 more" when it could just be named.
const MAX_NAMED = 3

// On hover the stack fans open around its centre: literal classes so Tailwind
// sees them, keyed by how many slots are drawn.
const HOVER_SPREAD: Record<number, string[]> = {
	2: ['group-hover/stack:-translate-x-px', 'group-hover/stack:translate-x-px'],
	3: ['group-hover/stack:-translate-x-0.5', '', 'group-hover/stack:translate-x-0.5'],
}

const SLOT_CLASS = tw`rounded-[4px] ring-1 ring-black/60 transition-transform duration-200 ease-out motion-reduce:transition-none`

// Tiny overlapping app icons that mark a folder some apps reach into. Hover
// explains which apps in a dark tooltip.
export function FolderAppStack({
	apps,
	size = 14,
	className,
}: {
	apps: FolderStorageApp[]
	size?: number
	className?: string
}) {
	const {t, i18n} = useTranslation()

	const label = useMemo(() => {
		const listFormat = new Intl.ListFormat(i18n.language, {style: 'long', type: 'conjunction'})
		const names = apps.map((app) => app.name)
		const hiddenCount = names.length - MAX_NAMED
		const parts =
			hiddenCount > 1 ? [...names.slice(0, MAX_NAMED), t('files-app-storage.more-apps', {count: hiddenCount})] : names
		return t('files-app-storage.also-used-by', {apps: listFormat.format(parts)})
	}, [apps, t, i18n.language])

	if (apps.length === 0) return null

	const shownApps = apps.slice(0, MAX_ICONS)
	const hiddenCount = apps.length - shownApps.length
	const slotCount = shownApps.length + (hiddenCount > 0 ? 1 : 0)
	const spread = HOVER_SPREAD[slotCount] ?? []
	// Overlap by a bit under a third of a slot so each icon behind stays legible
	const overlap = Math.round(size * 0.3)

	return (
		<DarkTooltip label={label} className='max-w-96 rounded-12 px-3 py-1.5 text-center text-balance whitespace-normal'>
			<span role='img' aria-label={label} className={cn('group/stack inline-flex shrink-0 items-center', className)}>
				{shownApps.map((app, index) => (
					<AppIcon
						key={app.id}
						src={app.icon}
						size={size}
						className={cn(SLOT_CLASS, spread[index])}
						style={index > 0 ? {marginLeft: -overlap} : undefined}
					/>
				))}
				{hiddenCount > 0 && (
					<span
						className={cn(
							SLOT_CLASS,
							'flex items-center justify-center bg-white/15 font-semibold -tracking-2 text-white/85 tabular-nums select-none',
							spread[slotCount - 1],
						)}
						style={{
							width: size,
							height: size,
							marginLeft: -overlap,
							fontSize: hiddenCount >= 10 ? size * 0.46 : size * 0.57,
							lineHeight: 1,
						}}
					>
						+{hiddenCount}
					</span>
				)}
			</span>
		</DarkTooltip>
	)
}
