import {useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue} from 'motion/react'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'

import {AVATAR_SIZE, type DockLayout} from '@/modules/auth/dock-geometry'

const GLASS_SIZE = 156
const FREE_LENS_SCALE = 0.8
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

export const dockSpring = {type: 'spring', stiffness: 320, damping: 28} as const
const lensFollowSpring = {type: 'spring', stiffness: 550, damping: 35, mass: 0.6} as const
const lensFreeSpring = {type: 'spring', stiffness: 230, damping: 24, mass: 0.9} as const

type LensMode = 'docked' | 'hover' | 'free'

function useLensSpring(target: MotionValue<number>, mode: LensMode) {
	// Keep each personality attached to the shared target. Reconfiguring one
	// useSpring in place can cancel an in-flight retarget when the mode changes.
	const docked = useSpring(target, dockSpring)
	const hover = useSpring(target, lensFollowSpring)
	const free = useSpring(target, lensFreeSpring)
	return mode === 'free' ? free : mode === 'hover' ? hover : docked
}

type UseAccountDockMotionOptions = {
	layout: DockLayout
	selectedIndex: number
	hoveredIndex: number | null
	chosen: boolean
	disabled: boolean
	canFloat: boolean
	onSelect: (index: number) => void
	onBrowse: (index: number) => void
	onHover: (index: number | null) => void
}

export function useAccountDockMotion({
	layout,
	selectedIndex,
	hoveredIndex,
	chosen,
	disabled,
	canFloat,
	onSelect,
	onBrowse,
	onHover,
}: UseAccountDockMotionOptions) {
	const viewportRef = useRef<HTMLDivElement>(null)
	const settleTimer = useRef<number | undefined>(undefined)
	const skipNextCenter = useRef(false)
	const dragging = useRef(false)
	const suppressClick = useRef(false)
	const disabledRef = useRef(disabled)
	disabledRef.current = disabled
	const callbacks = useRef({onSelect, onBrowse, onHover})
	callbacks.current = {onSelect, onBrowse, onHover}
	const dockState = useRef({layout, selectedIndex})
	useLayoutEffect(() => {
		dockState.current = {layout, selectedIndex}
	}, [layout, selectedIndex])

	const reduceMotion = Boolean(useReducedMotion())
	const initialStripX = -(layout.centers[selectedIndex] ?? 0)
	const stripTarget = useMotionValue(initialStripX)
	const stripX = useSpring(stripTarget, dockSpring)

	const [lensMode, setLensMode] = useState<LensMode>('docked')
	const initialAnchor = layout.centers[selectedIndex] ?? 0
	const lensAnchorTarget = useMotionValue(initialAnchor)
	const lensYTarget = useMotionValue(0)
	const lensScaleTarget = useMotionValue(1)
	const sprungLensAnchor = useLensSpring(lensAnchorTarget, lensMode)
	const sprungLensY = useLensSpring(lensYTarget, lensMode)
	const sprungLensScale = useLensSpring(lensScaleTarget, lensMode)
	const lensAnchor = reduceMotion ? lensAnchorTarget : sprungLensAnchor
	const lensY = reduceMotion ? lensYTarget : sprungLensY
	const lensScale = reduceMotion ? lensScaleTarget : sprungLensScale
	const lensX = useTransform([stripX, lensAnchor], ([strip, anchor]: number[]) => strip + anchor)

	const targetDockedLens = useCallback(
		(index: number, mode: Exclude<LensMode, 'free'>) => {
			setLensMode(mode)
			lensAnchorTarget.set(layout.centers[index] ?? 0)
			lensYTarget.set(0)
			lensScaleTarget.set((layout.sizes[index] ?? AVATAR_SIZE) / AVATAR_SIZE)
		},
		[layout, lensAnchorTarget, lensScaleTarget, lensYTarget],
	)

	const moveStripTo = useCallback(
		(target: number, immediate = reduceMotion) => {
			if (immediate) stripX.jump(target)
			stripTarget.set(target)
		},
		[reduceMotion, stripTarget, stripX],
	)

	const browseAt = useCallback(
		(value: number) => {
			if (disabledRef.current) return
			const nearest = layout.nearestIndexAt(value)
			if (nearest === selectedIndex) return
			skipNextCenter.current = true
			callbacks.current.onBrowse(nearest)
		},
		[layout, selectedIndex],
	)

	const settleSoon = useCallback(
		(delay = 140) => {
			if (disabledRef.current) return
			window.clearTimeout(settleTimer.current)
			settleTimer.current = window.setTimeout(() => {
				// A browse can select an account and switch to the tapered chosen
				// layout before this timer fires. Always settle that selection using
				// the current geometry, not the geometry captured by the gesture.
				const {layout: currentLayout, selectedIndex: currentIndex} = dockState.current
				moveStripTo(-(currentLayout.centers[currentIndex] ?? 0))
			}, delay)
		},
		[moveStripTo],
	)

	// Authentication freezes the dock in place. Reset any gesture/hover state
	// immediately so an in-flight request stays visually tied to its account.
	useLayoutEffect(() => {
		if (!disabled) {
			suppressClick.current = false
			return
		}
		dragging.current = false
		suppressClick.current = true
		skipNextCenter.current = false
		window.clearTimeout(settleTimer.current)
		moveStripTo(-(layout.centers[selectedIndex] ?? 0))
	}, [disabled, layout.centers, moveStripTo, selectedIndex])

	// Clicks and keyboard selection center the strip. Gesture-driven selection
	// changes are allowed to finish through the shared settle path instead.
	useEffect(() => {
		if (skipNextCenter.current) {
			skipNextCenter.current = false
			return
		}
		window.clearTimeout(settleTimer.current)
		moveStripTo(-(layout.centers[selectedIndex] ?? 0))
	}, [layout, moveStripTo, selectedIndex])

	// Rebase the lens before paint when choosing an account changes the dock's
	// geometry. This prevents a target from the full-size picker lingering until
	// the next pointer move on the tapered password dock.
	useLayoutEffect(() => {
		if (disabled) {
			setLensMode('docked')
			lensAnchorTarget.set(layout.centers[selectedIndex] ?? 0)
			lensYTarget.set(0)
			lensScaleTarget.set((layout.sizes[selectedIndex] ?? AVATAR_SIZE) / AVATAR_SIZE)
			if (hoveredIndex !== null) callbacks.current.onHover(null)
			return
		}

		if (lensMode === 'free') {
			if (!chosen) return
			setLensMode('docked')
			lensAnchorTarget.set(layout.centers[selectedIndex] ?? 0)
			lensYTarget.set(0)
			lensScaleTarget.set((layout.sizes[selectedIndex] ?? AVATAR_SIZE) / AVATAR_SIZE)
			callbacks.current.onHover(null)
			return
		}

		const focusIndex = hoveredIndex ?? selectedIndex
		setLensMode(hoveredIndex === null ? 'docked' : 'hover')
		lensAnchorTarget.set(layout.centers[focusIndex] ?? 0)
		lensYTarget.set(0)
		lensScaleTarget.set((layout.sizes[focusIndex] ?? AVATAR_SIZE) / AVATAR_SIZE)
	}, [
		chosen,
		disabled,
		hoveredIndex,
		layout.centers,
		layout.sizes,
		lensAnchorTarget,
		lensMode,
		lensScaleTarget,
		lensYTarget,
		selectedIndex,
	])

	// Track the pointer globally so the lens can be plucked beyond the dock. The
	// event only changes targets; the persistent springs own all frame-by-frame
	// movement.
	useEffect(() => {
		if (disabled) return
		if (!window.matchMedia(FINE_POINTER_QUERY).matches) return

		const handlePointerMove = (event: PointerEvent) => {
			if (disabledRef.current || event.pointerType !== 'mouse' || dragging.current) return
			const viewport = viewportRef.current
			if (!viewport || layout.centers.length === 0) return

			const rect = viewport.getBoundingClientRect()
			const pointerX = event.clientX - rect.left - rect.width / 2
			const pointerY = event.clientY - rect.top - rect.height / 2
			const stripLocalX = pointerX - stripX.get()
			const inBand = event.clientY >= rect.top && event.clientY <= rect.bottom
			const inRow =
				stripLocalX >= layout.centers[0] - AVATAR_SIZE &&
				stripLocalX <= layout.centers[layout.centers.length - 1] + AVATAR_SIZE

			if (inBand && inRow) {
				const nearest = layout.nearestIndexAt(stripX.get() - pointerX)
				targetDockedLens(nearest, 'hover')
				callbacks.current.onHover(nearest)
				return
			}

			if (!chosen && !reduceMotion && canFloat) {
				setLensMode('free')
				const halfLens = (GLASS_SIZE * FREE_LENS_SCALE) / 2 + 16
				const dockCenterX = rect.left + rect.width / 2
				const dockCenterY = rect.top + rect.height / 2
				const targetX = Math.max(halfLens - dockCenterX, Math.min(window.innerWidth - halfLens - dockCenterX, pointerX))
				const targetY = Math.max(
					halfLens - dockCenterY,
					Math.min(window.innerHeight - halfLens - dockCenterY, pointerY),
				)
				lensAnchorTarget.set(targetX - stripX.get())
				lensYTarget.set(targetY)
				lensScaleTarget.set(FREE_LENS_SCALE)
				return
			}

			targetDockedLens(selectedIndex, 'docked')
			callbacks.current.onHover(null)
		}

		const handlePointerLeave = () => {
			if (disabledRef.current) return
			targetDockedLens(selectedIndex, 'docked')
			callbacks.current.onHover(null)
		}

		window.addEventListener('pointermove', handlePointerMove)
		document.documentElement.addEventListener('mouseleave', handlePointerLeave)
		window.addEventListener('blur', handlePointerLeave)
		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			document.documentElement.removeEventListener('mouseleave', handlePointerLeave)
			window.removeEventListener('blur', handlePointerLeave)
		}
	}, [
		canFloat,
		chosen,
		disabled,
		layout,
		lensAnchorTarget,
		lensScaleTarget,
		lensYTarget,
		reduceMotion,
		selectedIndex,
		stripX,
		targetDockedLens,
	])

	// Horizontal trackpad input directly scrubs the strip, then settles the
	// nearest account under the lens after input stops.
	useEffect(() => {
		if (disabled) return
		const viewport = viewportRef.current
		if (!viewport) return

		const handleWheel = (event: WheelEvent) => {
			if (disabledRef.current) return
			if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
			event.preventDefault()
			const next = Math.min(layout.maxX, Math.max(layout.minX, stripX.get() - event.deltaX))
			stripX.jump(next)
			stripTarget.set(next)
			browseAt(next)
			settleSoon()
		}

		viewport.addEventListener('wheel', handleWheel, {passive: false})
		return () => viewport.removeEventListener('wheel', handleWheel)
	}, [browseAt, disabled, layout.maxX, layout.minX, settleSoon, stripTarget, stripX])

	useEffect(() => () => window.clearTimeout(settleTimer.current), [])

	const dragConstraints = useMemo(() => ({left: layout.minX, right: layout.maxX}), [layout.maxX, layout.minX])
	const lensStyle = useMemo(() => ({x: lensX, y: lensY, scale: lensScale}), [lensScale, lensX, lensY])

	return {
		viewportRef,
		stripX,
		lensStyle,
		dragConstraints,
		reduceMotion,
		onPointerDownCapture: () => {
			if (disabledRef.current) return
			suppressClick.current = false
		},
		onDragStart: () => {
			if (disabledRef.current) return
			dragging.current = true
			suppressClick.current = true
			targetDockedLens(selectedIndex, 'docked')
			callbacks.current.onHover(null)
		},
		onDrag: () => browseAt(stripX.get()),
		onDragEnd: () => {
			if (disabledRef.current) return
			dragging.current = false
			settleSoon(0)
		},
		onAccountClick: (index: number) => {
			if (!disabledRef.current && !suppressClick.current) callbacks.current.onSelect(index)
		},
	}
}
