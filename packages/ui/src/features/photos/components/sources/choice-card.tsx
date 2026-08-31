import {Check, ChevronRight} from 'lucide-react'
import type {ComponentType, ReactNode} from 'react'

import {cn} from '@/lib/utils'

// A selectable option with artwork (or a glyph), title and description — the
// same card the cloud download wizard uses for its modes, grown a slot for
// device artwork, a trailing badge ("Coming soon") and a chevron affordance.
export function ChoiceCard({
	icon: Icon,
	art,
	selected,
	title,
	description,
	badge,
	chevron,
	onClick,
	disabled,
}: {
	icon?: ComponentType<{className?: string}>
	// Rendered in place of the glyph — e.g. the Sources' device artwork
	art?: ReactNode
	selected: boolean
	title: string
	description?: string
	// Trailing pill, e.g. "Coming soon" on a locked option
	badge?: string
	chevron?: boolean
	onClick: () => void
	disabled?: boolean
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			disabled={disabled}
			aria-pressed={selected}
			className={cn(
				'group flex flex-1 items-center gap-3.5 rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
				selected ? 'border-brand bg-brand/15' : 'border-white/8 bg-white/5 enabled:hover:bg-white/10',
			)}
		>
			{art}
			{Icon && (
				<Icon className={cn('size-5 shrink-0 transition-colors', selected ? 'text-brand-lighter' : 'text-white/40')} />
			)}
			<span className='min-w-0 flex-1'>
				<span className='flex items-center gap-2 text-sm'>
					<span className='truncate'>{title}</span>
					{selected && (
						<span className='flex size-[18px] shrink-0 items-center justify-center rounded-full bg-brand'>
							<Check className='size-3 text-white' strokeWidth={3.5} />
						</span>
					)}
				</span>
				{description && <span className='mt-0.5 block text-12 leading-relaxed text-white/50'>{description}</span>}
			</span>
			{badge && (
				<span className='shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-11 font-medium whitespace-nowrap text-white/60'>
					{badge}
				</span>
			)}
			{chevron && !disabled && (
				<ChevronRight className='size-4 shrink-0 text-white/25 transition-colors group-hover:text-white/50' />
			)}
		</button>
	)
}
