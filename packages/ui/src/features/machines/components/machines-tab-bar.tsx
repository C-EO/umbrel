import {LayoutGrid, Plus} from 'lucide-react'
import {motion} from 'motion/react'
import {useEffect, useRef} from 'react'
import {NavLink, useLocation} from 'react-router-dom'

import {MachinesTooltip} from '@/features/machines/components/machines-tooltip'
import {OsIcon} from '@/features/machines/components/os-icon'
import {layoutMorphTransition, machinePath, MACHINES_ADD_PATH, MACHINES_PATH} from '@/features/machines/constants'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

const tabClass = tw`flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/8 bg-[rgba(35,35,35,0.64)] text-14 font-semibold -tracking-2 whitespace-nowrap text-white/85 backdrop-blur-md transition-[background-color,border-color,color,transform] duration-200 hover:bg-[rgba(55,55,55,0.64)] hover:text-white focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/20 active:scale-95`
const tabActiveClass = tw`border-white/60 bg-[rgba(68,68,68,0.64)] text-white hover:bg-[rgba(68,68,68,0.64)]`

// Each pill animates its own position during the column-width morph (the nav
// itself is full-width and a scroll container, so animating it does nothing)
const MotionNavLink = motion.create(NavLink)

function Tab({
	to,
	end,
	label,
	children,
	className,
	ref,
	...props
}: {
	to: string
	end?: boolean
	label?: string
	children: React.ReactNode
	className?: string
	ref?: React.Ref<HTMLAnchorElement>
} & Omit<
	React.ComponentPropsWithoutRef<typeof NavLink>,
	'to' | 'className' | 'children' | 'style' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>) {
	return (
		<MotionNavLink
			layout='position'
			transition={layoutMorphTransition}
			to={to}
			end={end}
			ref={ref}
			aria-label={label}
			className={({isActive}: {isActive: boolean}) => cn(tabClass, isActive && tabActiveClass, className)}
			{...props}
		>
			{children}
		</MotionNavLink>
	)
}

export function MachinesTabBar({machines}: {machines: Machine[]}) {
	const navRef = useRef<HTMLElement>(null)
	const {pathname} = useLocation()

	// One horizontally scrollable row (no wrapping); keep the active tab in view
	useEffect(() => {
		navRef.current
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({inline: 'nearest', block: 'nearest', behavior: 'smooth'})
	}, [pathname])

	return (
		<nav
			ref={navRef}
			className='-my-1 flex items-center gap-3 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
		>
			<MachinesTooltip label={t('machines.all-machines')} side='bottom'>
				<Tab to={MACHINES_PATH} end label={t('machines.all-machines')} className='w-10'>
					<LayoutGrid className='size-5' />
				</Tab>
			</MachinesTooltip>
			<MachinesTooltip label={t('machines.add-machine')} side='bottom'>
				<Tab to={MACHINES_ADD_PATH} label={t('machines.add-machine')} className='w-10'>
					<Plus className='size-5' />
				</Tab>
			</MachinesTooltip>
			{machines.map((machine) => (
				<Tab key={machine.id} to={machinePath(machine.id)} className='animate-in px-3 duration-300 fade-in'>
					<OsIcon osId={machine.osId} className='size-6' />
					<span className='max-w-40 truncate'>{machine.name}</span>
				</Tab>
			))}
		</nav>
	)
}
