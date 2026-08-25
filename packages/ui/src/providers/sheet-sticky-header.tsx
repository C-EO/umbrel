// NOTE: in the future, may want to use this for dialogs, but for now only works for sheets

import {Portal} from '@radix-ui/react-portal'
import {ComponentPropsWithoutRef, createContext, useContext, useEffect, useState} from 'react'

import {cn} from '@/lib/utils'

const DEFAULT_SCROLL_THRESHOLD = 110
// Once shown, the bar hides a little earlier than it appeared so tiny scroll
// jitters around the threshold can't make it flicker
const HIDE_HYSTERESIS = 30
export const SHEET_HEADER_ID = 'sheet-header-root-id'

type ContextT = {
	showStickyHeader: boolean
	hasStickyHeader: boolean
	setHasStickyHeader: (has: boolean) => void
	// Lets a page pick the scroll depth where the bar takes over (e.g. the app
	// page hands over once its hero is half scrolled away)
	setStickyThreshold: (threshold: number) => void
	// The sheet's scroll viewport, so pages can measure content offsets
	scrollRef: React.RefObject<HTMLDivElement | null> | null
	// Lets a page suppress the sheet's floating close button while it renders its
	// own close affordance (see settings on mobile, where a sticky controls rail
	// would otherwise sit underneath it).
	hideCloseButton: boolean
	setHideCloseButton: (hide: boolean) => void
}

const StickyContext = createContext<ContextT | null>(null)

export function SheetStickyHeaderProvider({
	children,
	scrollRef,
}: {
	children: React.ReactNode
	scrollRef: React.RefObject<HTMLDivElement | null>
}) {
	const [hasStickyHeader, setHasStickyHeader] = useState(false)
	const [showScrollStickyHeader, setShowScrollStickyHeader] = useState(false)
	const [threshold, setThreshold] = useState(DEFAULT_SCROLL_THRESHOLD)
	const [hideCloseButton, setHideCloseButton] = useState(false)

	useEffect(() => {
		const el = scrollRef.current
		const scrollHandler = () => {
			const scrollTop = scrollRef.current?.scrollTop ?? 0
			setShowScrollStickyHeader((shown) => {
				if (!hasStickyHeader) return false
				return scrollTop > (shown ? threshold - HIDE_HYSTERESIS : threshold)
			})
		}

		scrollHandler()
		el?.addEventListener('scroll', scrollHandler, {passive: true})

		return () => el?.removeEventListener('scroll', scrollHandler)
	}, [scrollRef, hasStickyHeader, threshold])

	return (
		<StickyContext
			value={{
				showStickyHeader: showScrollStickyHeader,
				hasStickyHeader,
				setHasStickyHeader,
				setStickyThreshold: setThreshold,
				scrollRef,
				hideCloseButton,
				setHideCloseButton,
			}}
		>
			{children}
		</StickyContext>
	)
}

export function useSheetStickyHeader() {
	const ctx = useContext(StickyContext)
	if (!ctx) throw new Error('useSheetStickyHeader must be used within SheetStickyHeaderProvider')

	return ctx
}

// ---

export function SheetStickyHeader({
	threshold,
	...props
}: ComponentPropsWithoutRef<'div'> & {
	/** Scroll depth (px) where the bar takes over; defaults to the header height */
	threshold?: number
}) {
	const {setHasStickyHeader, setStickyThreshold} = useSheetStickyHeader()

	useEffect(() => {
		setHasStickyHeader(true)
		if (threshold !== undefined) setStickyThreshold(threshold)
		return () => {
			setHasStickyHeader(false)
			setStickyThreshold(DEFAULT_SCROLL_THRESHOLD)
		}
	}, [setHasStickyHeader, setStickyThreshold, threshold])

	return <Portal container={document.getElementById(SHEET_HEADER_ID)} {...props} />
}

export function SheetStickyHeaderTarget() {
	const {showStickyHeader} = useSheetStickyHeader()

	return (
		<div
			id={SHEET_HEADER_ID}
			// `inert` (rather than `invisible`) keeps the hidden bar out of the tab
			// order and accessibility tree while still allowing the soft reveal
			inert={!showStickyHeader}
			className={cn('absolute inset-x-0 top-0 z-50 h-[76px] px-5', !showStickyHeader && 'pointer-events-none')}
		>
			{/* The surface fades as a layer BEHIND the portalled content, so shared
			    elements gliding into the bar stay fully visible during their morph
			    instead of fading in with the bar */}
			<div
				aria-hidden
				className={cn(
					'umbrel-window-surface-top absolute inset-0 -z-10 border-b border-white/10 bg-black/50 backdrop-blur-xl',
					'transition-opacity duration-150 ease-out',
					showStickyHeader ? 'opacity-100' : 'opacity-0',
				)}
				style={{
					boxShadow: '2px 2px 2px 0px #FFFFFF0D inset',
				}}
			/>
		</div>
	)
}
