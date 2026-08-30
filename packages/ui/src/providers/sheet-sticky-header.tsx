// NOTE: in the future, may want to use this for dialogs, but for now only works for sheets

import {Portal} from '@radix-ui/react-portal'
import {ComponentPropsWithoutRef, createContext, useContext, useLayoutEffect, useState} from 'react'

import {cn} from '@/lib/utils'

export const SHEET_HEADER_ID = 'sheet-header-root-id'
export const SHEET_STICKY_HEADER_HEIGHT = 64

type ContextT = {
	showStickyHeader: boolean
	setShowStickyHeader: (show: boolean) => void
	showStickyHeaderSurface: boolean
	setShowStickyHeaderSurface: (show: boolean) => void
	fadeStickyHeaderSurface: boolean
	setFadeStickyHeaderSurface: (fade: boolean) => void
	// State-backed rather than a RefObject so consumers rebind when Radix mounts
	// or replaces the actual viewport element.
	scrollElement: HTMLDivElement | null
}

const StickyContext = createContext<ContextT | null>(null)

export function SheetStickyHeaderProvider({
	children,
	scrollElement,
}: {
	children: React.ReactNode
	scrollElement: HTMLDivElement | null
}) {
	const [showStickyHeader, setShowStickyHeader] = useState(false)
	const [showStickyHeaderSurface, setShowStickyHeaderSurface] = useState(false)
	const [fadeStickyHeaderSurface, setFadeStickyHeaderSurface] = useState(false)

	return (
		<StickyContext
			value={{
				showStickyHeader,
				setShowStickyHeader,
				showStickyHeaderSurface,
				setShowStickyHeaderSurface,
				fadeStickyHeaderSurface,
				setFadeStickyHeaderSurface,
				scrollElement,
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
	visible,
	surfaceVisible = visible,
	animateContent = true,
	fadeSurface = false,
	...props
}: ComponentPropsWithoutRef<'div'> & {
	visible: boolean
	/** Allows chrome to pin before its occluding surface appears. */
	surfaceVisible?: boolean
	/** Disable the wrapper fade when the page supplies its own scroll-linked motion. */
	animateContent?: boolean
	/** Fade the surface in after it becomes visible; exits remain immediate. */
	fadeSurface?: boolean
}) {
	const {setShowStickyHeader, setShowStickyHeaderSurface, setFadeStickyHeaderSurface} = useSheetStickyHeader()

	useLayoutEffect(() => {
		setShowStickyHeader(visible)
		return () => setShowStickyHeader(false)
	}, [setShowStickyHeader, visible])

	useLayoutEffect(() => {
		setShowStickyHeaderSurface(surfaceVisible)
		return () => setShowStickyHeaderSurface(false)
	}, [setShowStickyHeaderSurface, surfaceVisible])

	useLayoutEffect(() => {
		setFadeStickyHeaderSurface(fadeSurface)
		return () => setFadeStickyHeaderSurface(false)
	}, [fadeSurface, setFadeStickyHeaderSurface])

	return (
		<Portal container={document.getElementById(SHEET_HEADER_ID)} className='block h-full'>
			<div
				aria-hidden={!visible}
				inert={!visible}
				{...props}
				className={cn(
					'pointer-events-none relative z-10 h-full',
					animateContent && 'transition-[opacity,transform] duration-[180ms] ease-out motion-reduce:transition-none',
					visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
					props.className,
				)}
			/>
		</Portal>
	)
}

export function SheetStickyHeaderTarget() {
	const {showStickyHeader, showStickyHeaderSurface, fadeStickyHeaderSurface, scrollElement} = useSheetStickyHeader()
	const scrollToTop = () => {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		scrollElement?.scrollTo({top: 0, behavior: reduceMotion ? 'auto' : 'smooth'})
	}

	return (
		<div
			id={SHEET_HEADER_ID}
			data-state={showStickyHeader ? 'visible' : 'hidden'}
			data-surface-state={showStickyHeaderSurface ? 'visible' : 'hidden'}
			aria-hidden={!showStickyHeader}
			inert={!showStickyHeader}
			className={cn(
				'absolute inset-x-0 top-0 z-50 h-16',
				showStickyHeader ? 'pointer-events-auto' : 'pointer-events-none',
			)}
		>
			{/* The App Store pins its morphing content first, then fades this surface
			    in only after the controls have reached their compact positions. */}
			<button
				type='button'
				aria-hidden
				tabIndex={-1}
				onClick={scrollToTop}
				className={cn(
					'umbrel-window-surface-top absolute inset-0 cursor-default border-b border-white/10 bg-black',
					showStickyHeaderSurface
						? cn(
								'opacity-100',
								fadeStickyHeaderSurface
									? 'transition-opacity duration-[180ms] ease-out motion-reduce:transition-none'
									: 'transition-none',
							)
						: 'opacity-0 transition-none',
				)}
				style={{
					boxShadow: '2px 2px 2px 0px #FFFFFF0D inset',
				}}
			/>
		</div>
	)
}
