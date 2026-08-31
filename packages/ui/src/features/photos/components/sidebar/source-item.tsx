import {Ellipsis} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-linear-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

// A source row (this Umbrel, a phone, a drive, a NAS) with a trailing "⋯" menu
// button: revealed on hover on desktop, always visible on mobile where there's
// no hover. It opens the source details dialog.
export function SourceItem({
	label,
	icon,
	isActive,
	onClick,
	onOptions,
}: {
	label: string
	icon: React.ReactNode
	isActive: boolean
	onClick: () => void
	onOptions: () => void
}) {
	const {t} = useTranslation()
	return (
		<div
			role='button'
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					onClick()
				}
			}}
			aria-current={isActive ? 'page' : undefined}
			className={cn(
				'group flex w-full cursor-default items-center gap-2 rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 text-12 hover:bg-linear-to-b',
				isActive ? selectedClass : 'text-white/60 hover:bg-white/10 hover:text-white',
			)}
		>
			<span className='flex h-5 w-5 shrink-0 items-center justify-center'>{icon}</span>
			<span className='min-w-0 flex-1 truncate'>{label}</span>
			<button
				aria-label={t('photos-sidebar.source-options', {name: label})}
				onClick={(e) => {
					e.stopPropagation()
					onOptions()
				}}
				className={cn(
					'-my-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white',
					// Hover-only on desktop; mobile has no hover so keep it visible
					'lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100',
					focusRingClass,
				)}
			>
				<Ellipsis className='size-3' />
			</button>
		</div>
	)
}
