import {Search} from 'lucide-react'
import {ReactNode} from 'react'

import {SegmentedControl} from '@/components/ui/segmented-control'
import {cn} from '@/lib/utils'

import {SETTINGS_FILTER_IDS, SettingsCategoryId, SettingsFilterId} from './settings-taxonomy'

export function SettingsFilterPills({
	activeFilter,
	labels,
	ariaLabel,
	onSelect,
	className,
}: {
	activeFilter: SettingsFilterId
	labels: Record<SettingsFilterId, string>
	ariaLabel: string
	onSelect: (filter: SettingsFilterId) => void
	className?: string
}) {
	const tabs = SETTINGS_FILTER_IDS.map((filterId) => ({id: filterId, label: labels[filterId]}))

	return (
		<SegmentedControl
			value={activeFilter}
			onValueChange={onSelect}
			tabs={tabs}
			variant='muted-primary'
			ariaLabel={ariaLabel}
			className={cn(
				'settings-edge-material umbrel-hide-scrollbar h-11 min-w-0 shrink gap-1 overflow-x-auto rounded-24 border-0 p-1.5 text-13 text-white',
				className,
			)}
			tabClassName='flex shrink-0 items-center justify-center px-2.5 pb-0 font-medium -tracking-2'
		/>
	)
}

export function SettingsSearch({
	value,
	onChange,
	label,
	className,
}: {
	value: string
	onChange: (value: string) => void
	label: string
	className?: string
}) {
	return (
		<div
			className={cn(
				'settings-edge-material flex h-11 w-[184px] shrink-0 items-center gap-2 overflow-hidden rounded-24 bg-white/3 px-3 text-white/55 focus-within:bg-white/7',
				className,
			)}
		>
			<Search className='size-4 shrink-0' aria-hidden='true' />
			<input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') onChange('')
				}}
				placeholder={label}
				aria-label={label}
				className='min-w-0 flex-1 bg-transparent text-12 text-white outline-hidden placeholder:text-white/40'
			/>
		</div>
	)
}

export function SettingsItemsGroup({
	id,
	label,
	children,
	overflowVisible = false,
}: {
	id: SettingsCategoryId
	label: string
	children: ReactNode
	overflowVisible?: boolean
}) {
	return (
		<section
			id={`settings-category-${id}`}
			className='scroll-mt-[76px]'
			aria-labelledby={`settings-category-${id}-title`}
		>
			<h2 id={`settings-category-${id}-title`} className='sr-only'>
				{label}
			</h2>
			<div
				className={cn(
					'settings-list-group divide-y divide-white/8 rounded-24 bg-white/4',
					overflowVisible ? 'overflow-visible' : 'overflow-hidden',
				)}
			>
				{children}
			</div>
		</section>
	)
}
