import {motion} from 'motion/react'
import {useEffect, useMemo, useRef, type KeyboardEvent} from 'react'

import {Glass, REFRACT} from '@/components/ui/glass'
import {cn} from '@/lib/utils'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {AVATAR_SIZE, calculateDockLayout} from '@/modules/auth/dock-geometry'
import {dockSpring, useAccountDockMotion} from '@/modules/auth/use-account-dock-motion'
import {type Account} from '@/modules/auth/use-account-picker'

const GLASS_SIZE = 156

/** The pure-glass disc that magnifies the selected account. */
function AccountLens({size = GLASS_SIZE}: {size?: number}) {
	return (
		<Glass
			blur={0}
			edgeBlur={1.25}
			saturate={1.25}
			brightness={1.2}
			scale={35}
			chroma={0.2}
			bevel='50px'
			className='rounded-full'
			style={{width: size, height: size}}
		/>
	)
}

/**
 * Dock-like account picker shared by the lock screen and app proxy login.
 * Layout is pure, interaction lives in one hook, and this component only
 * renders the strip, semantic account buttons, and lens.
 */
export function AccountDock({
	accounts,
	selectedIndex,
	hoveredIndex,
	chosen,
	disabled,
	onSelect,
	onBrowse,
	onHover,
}: {
	accounts: Account[]
	selectedIndex: number
	hoveredIndex: number | null
	chosen: boolean
	disabled: boolean
	onSelect: (index: number) => void
	onBrowse: (index: number) => void
	onHover: (index: number | null) => void
}) {
	const hasMounted = useRef(false)
	const accountButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
	useEffect(() => {
		hasMounted.current = true
	}, [])

	const layout = useMemo(
		() => calculateDockLayout({accountCount: accounts.length, selectedIndex, chosen}),
		[accounts.length, chosen, selectedIndex],
	)
	const dockMotion = useAccountDockMotion({
		layout,
		selectedIndex,
		hoveredIndex,
		chosen,
		disabled,
		canFloat: REFRACT,
		onSelect,
		onBrowse,
		onHover,
	})
	const handleAccountKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		if (disabled) return
		const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
		if (direction === 0) return

		event.preventDefault()
		const nextIndex = index + direction
		if (nextIndex < 0 || nextIndex >= accounts.length) return
		accountButtonRefs.current[nextIndex]?.focus()
	}

	return (
		<div ref={dockMotion.viewportRef} aria-busy={disabled} className='relative -mt-[60px] h-[180px] w-screen'>
			<div className='absolute inset-0 overflow-hidden'>
				<div className='absolute top-1/2 left-1/2'>
					<motion.div
						drag={disabled ? false : 'x'}
						dragConstraints={dockMotion.dragConstraints}
						dragElastic={0.12}
						dragMomentum={false}
						style={{x: dockMotion.stripX}}
						onPointerDownCapture={dockMotion.onPointerDownCapture}
						onDragStart={dockMotion.onDragStart}
						onDrag={dockMotion.onDrag}
						onDragEnd={dockMotion.onDragEnd}
						className='relative'
					>
						{accounts.map((account, index) => {
							const distance = Math.abs(index - selectedIndex)
							const scale = layout.sizes[index] / AVATAR_SIZE
							return (
								<motion.div
									key={account.userId}
									className={cn(
										'absolute flex items-center justify-center',
										disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
									)}
									style={{width: AVATAR_SIZE, height: AVATAR_SIZE, top: -AVATAR_SIZE / 2}}
									initial={false}
									animate={{x: layout.centers[index] - AVATAR_SIZE / 2, scale}}
									transition={dockMotion.reduceMotion ? {duration: 0} : dockSpring}
								>
									<motion.button
										ref={(button) => {
											accountButtonRefs.current[index] = button
										}}
										type='button'
										aria-label={account.name}
										aria-pressed={selectedIndex === index}
										tabIndex={selectedIndex === index ? 0 : -1}
										disabled={disabled}
										onFocus={() => {
											if (!disabled && index !== selectedIndex) onBrowse(index)
										}}
										onKeyDown={(event) => handleAccountKeyDown(event, index)}
										onClick={() => dockMotion.onAccountClick(index)}
										className='rounded-full focus:outline-hidden focus-visible:ring-4 focus-visible:ring-white/40'
										initial={dockMotion.reduceMotion ? false : {opacity: 0, scale: 0.3}}
										animate={{scale: 1, opacity: 1}}
										whileHover={disabled || dockMotion.reduceMotion ? undefined : {scale: 1.06}}
										whileTap={disabled || dockMotion.reduceMotion ? undefined : {scale: 0.95}}
										transition={
											dockMotion.reduceMotion
												? {duration: 0}
												: {...dockSpring, delay: hasMounted.current ? 0 : 0.06 + distance * 0.045}
										}
									>
										<AccountAvatar name={account.name} userId={account.userId} size={AVATAR_SIZE} />
									</motion.button>
								</motion.div>
							)
						})}
					</motion.div>
				</div>
			</div>

			<div className='pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2'>
				<motion.div style={dockMotion.lensStyle} className='will-change-transform'>
					<motion.div
						initial={dockMotion.reduceMotion ? false : {scale: 0.85, opacity: 0}}
						animate={{scale: 1, opacity: 1}}
						transition={dockMotion.reduceMotion ? {duration: 0} : {type: 'spring', stiffness: 260, damping: 20}}
					>
						<AccountLens />
					</motion.div>
				</motion.div>
			</div>
		</div>
	)
}
