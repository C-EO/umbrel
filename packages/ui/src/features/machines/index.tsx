import {motion} from 'motion/react'
import {lazy, Suspense, useCallback, useEffect, useState} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {Outlet, useNavigate, useParams} from 'react-router-dom'

import {MachineRail} from '@/features/machines/components/machine-rail'
import {MachinesTabBar} from '@/features/machines/components/machines-tab-bar'
import {MachinesTooltip} from '@/features/machines/components/machines-tooltip'
import {layoutMorphTransition} from '@/features/machines/constants'
import {useMachines, useMachinesLiveUpdates} from '@/features/machines/hooks/use-machines'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'

const VmSettingsDialog = lazy(() => import('@/features/machines/components/vm-settings-dialog'))

// Immersive overlay over the desktop wallpaper (the desktop content fades
// itself out for any non-root route, and the dock stays mounted via the
// router layout).
export default function MachinesLayout() {
	useMachinesLiveUpdates()
	const navigate = useNavigate()
	const {machines, isLoading} = useMachines()
	const {machineId} = useParams<{machineId: string}>()
	const [closing, setClosing] = useState(false)

	// Warm all in-feature lazy chunks once the feature is open so navigating
	// between pages never suspends (avoids blank flashes between views)
	useEffect(() => {
		import('@/features/machines/components/machines-index')
		import('@/features/machines/components/os-catalog')
		import('@/features/machines/components/create-machine')
		import('@/features/machines/components/machine-window')
		import('@/features/machines/components/vm-settings-dialog')
		import('@/features/files/components/mini-browser')
	}, [])

	// Fade the overlay out before actually leaving
	const close = useCallback(() => {
		setClosing(true)
		setTimeout(() => navigate('/'), 150)
	}, [navigate])

	// Escape closes the overlay via the same fade-out path as the close button.
	// Radix dialogs/menus preventDefault Escape when they consume it first (their
	// document-level listener fires before this window-level one), so gating on
	// defaultPrevented keeps Escape inside the settings dialog / a MiniBrowser
	// from also tearing down the overlay. Text fields keep their own Escape too.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return
			const target = e.target as HTMLElement | null
			if (target?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return
			close()
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [close])

	// The machine console view gets a wider canvas than the catalog/list pages
	const isMachineView = !!machineId && machineId !== 'new'
	const machine = isMachineView ? machines.find((machine) => machine.id === machineId) : undefined

	return (
		<motion.div
			initial={{opacity: 0}}
			animate={{opacity: closing ? 0 : 1}}
			transition={{duration: 0.15, ease: 'easeOut'}}
			className='fixed inset-0 z-30 overflow-y-auto overscroll-contain bg-black/50 backdrop-blur-xl'
		>
			<motion.div
				initial={{scale: 0.985}}
				animate={{scale: closing ? 0.99 : 1}}
				transition={{duration: 0.2, ease: 'easeOut'}}
				className={cn(
					'mx-auto flex min-h-full w-full flex-col gap-5 px-4 pt-8 pb-4 md:px-8 md:pt-12',
					isMachineView ? 'max-w-[1600px]' : 'max-w-[1054px]',
				)}
			>
				{/* Header pieces animate their position with the same timing as the
				   container morph, so widening the column glides instead of jumping */}
				<div className='flex items-center justify-between'>
					<motion.div layout='position' transition={layoutMorphTransition} className='flex items-center gap-3'>
						<img
							src='/assets/dock/dock-machines.png'
							alt=''
							draggable={false}
							className='size-[50px] shrink-0 rounded-12 shadow-lg'
						/>
						<div className='flex flex-col gap-1.5'>
							<h1 className='text-17 leading-none font-semibold -tracking-2 text-white'>{t('machines')}</h1>
							<p className='text-15 leading-none -tracking-2 text-white/50'>{t('machines.tagline')}</p>
						</div>
					</motion.div>
					<motion.div layout='position' transition={layoutMorphTransition}>
						<MachinesTooltip label={t('close')} side='left'>
							<button onClick={close} aria-label={t('close')} className={dialogHeaderCircleButtonClass}>
								<RiCloseCircleFill className='h-5 w-5 lg:h-6 lg:w-6' />
							</button>
						</MachinesTooltip>
					</motion.div>
				</div>

				{!isLoading && machines.length > 0 && <MachinesTabBar machines={machines} />}

				{/* One persistent container shared by every page: the dark card holding
				   the catalog/list/create form morphs into the machine screen instead
				   of unmounting, so switching views never flickers */}
				<div className={cn('flex w-full flex-col items-start gap-3', isMachineView && 'xl:flex-row')}>
					<motion.div
						layout
						style={{borderRadius: isMachineView ? 12 : 24}}
						transition={layoutMorphTransition}
						className={cn(
							'relative w-full min-w-0 overflow-hidden shadow-dialog',
							isMachineView ? 'aspect-16/10 flex-1 border border-white/20 bg-black' : 'bg-black/60 backdrop-blur-2xl',
						)}
					>
						{/* layout='position' opts the content out of the container's FLIP scaling:
						   it snaps to its final size immediately (no stretching) while the box
						   resizes and clips around it */}
						<motion.div layout='position' transition={layoutMorphTransition} className='relative h-full w-full'>
							<Suspense>
								<Outlet />
							</Suspense>
						</motion.div>
					</motion.div>
					{machine && <MachineRail machine={machine} />}
				</div>

				<div className='grow' />
				<DockSpacer />
			</motion.div>

			<Suspense>
				<VmSettingsDialog />
			</Suspense>
		</motion.div>
	)
}
