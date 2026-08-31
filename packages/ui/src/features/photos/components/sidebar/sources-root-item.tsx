import {useTranslation} from 'react-i18next'
import {FaPlus} from 'react-icons/fa6'
import {useLocation, useNavigate} from 'react-router-dom'

import {sectionPath} from '@/features/photos/constants'
import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-linear-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

// Permanent "Sources" row with a trailing "+" to add one, styled like the Files
// sidebar's "Network Devices" row. "+" opens the add-source wizard.
export function SourcesRootItem({onAdd}: {onAdd: () => void}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {pathname} = useLocation()
	const path = sectionPath('sources')
	const isActive = pathname === path

	return (
		<div
			role='button'
			tabIndex={0}
			onClick={() => navigate(path)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					navigate(path)
				}
			}}
			aria-current={isActive ? 'page' : undefined}
			className='group flex items-stretch gap-0.5 rounded-lg text-12'
		>
			<div
				className={cn(
					'flex flex-1 items-center gap-2 rounded-l-lg border border-r-0 border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 group-hover:bg-linear-to-b',
					isActive ? selectedClass : 'text-white/60 group-hover:bg-white/10 group-hover:text-white',
				)}
			>
				{/* Served from public/ (not imported) so Vite can't inline it as a data URI, which the CSP blocks */}
				<img src='/assets/photos/sources-icon.webp' alt='' className='h-5 w-auto shrink-0' draggable={false} />
				<span className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>{t('photos-sidebar.sources')}</span>
			</div>
			<div
				className={cn(
					'group/plus flex items-center justify-center rounded-r-lg border border-l-0 border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 group-hover:bg-linear-to-b',
					isActive ? selectedClass : 'group-hover:bg-white/10',
				)}
				onClick={(e) => {
					// Don't navigate to the sources overview
					e.stopPropagation()
					onAdd()
				}}
			>
				<button
					aria-label={t('photos-sidebar.add-source')}
					className={cn(
						'-m-0.5 flex items-center justify-center rounded-full p-0.5 text-white/60 group-hover/plus:text-white',
						focusRingClass,
					)}
				>
					<FaPlus className='size-3' strokeWidth={5} />
				</button>
			</div>
		</div>
	)
}
