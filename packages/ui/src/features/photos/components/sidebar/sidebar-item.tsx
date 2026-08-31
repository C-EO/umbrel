import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-linear-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

export function SidebarItem({
	label,
	icon,
	isActive,
	disabled,
	onClick,
}: {
	label: string
	icon: React.ReactNode
	isActive: boolean
	disabled?: boolean
	onClick: () => void
}) {
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			aria-current={isActive ? 'page' : undefined}
			className={cn(
				'flex w-full items-center gap-2 rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 text-12 hover:bg-linear-to-b disabled:pointer-events-none disabled:opacity-40',
				isActive ? selectedClass : 'text-white/60 hover:bg-white/10 hover:text-white',
			)}
		>
			<span className='flex h-5 w-5 shrink-0 items-center justify-center'>{icon}</span>
			<span className='truncate'>{label}</span>
		</button>
	)
}
