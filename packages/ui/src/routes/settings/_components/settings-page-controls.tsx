import {ReactNode} from 'react'

import {FilterPills} from '@/components/ui/edge-controls'
import {cn} from '@/lib/utils'

import {SETTINGS_FILTER_IDS, SettingsCategoryId, SettingsFilterId} from './settings-taxonomy'

// Settings category pills on the shared edge-material controls (see components/ui/edge-controls.tsx)
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
		<FilterPills
			value={activeFilter}
			onValueChange={onSelect}
			tabs={tabs}
			ariaLabel={ariaLabel}
			className={className}
		/>
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
