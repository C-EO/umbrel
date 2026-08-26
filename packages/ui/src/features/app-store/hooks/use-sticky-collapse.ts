import {useMotionValue, useTransform, type MotionValue} from 'motion/react'
import {useLayoutEffect, useRef, useState} from 'react'

import {useSheetStickyHeader} from '@/providers/sheet-sticky-header'

const PIN_HYSTERESIS = 2

/**
 * Scroll-linked collapse motion for a visual tree rendered outside the sheet
 * scroller. The anchor is an explicit in-flow placeholder for that tree.
 *
 * Geometry is measured only on mount/resize. Scroll frames update MotionValues
 * directly, so the icon, title, controls, and actions can scrub continuously
 * without a React render or a layout read on every frame.
 */
export function useStickyCollapse(
	anchor: HTMLElement | null,
	distance: number,
): {progress: MotionValue<number>; wrapperY: MotionValue<number>; pinned: boolean; settled: boolean} {
	const {scrollElement} = useSheetStickyHeader()
	const scrollY = useMotionValue(0)
	const stickStart = useMotionValue(0)
	const pinnedRef = useRef(false)
	const [pinned, setPinned] = useState(false)
	const settledRef = useRef(false)
	const [settled, setSettled] = useState(false)

	const wrapperY = useTransform(() => Math.max(0, stickStart.get() - scrollY.get()))
	const progress = useTransform(() => Math.min(1, Math.max(0, (scrollY.get() - stickStart.get()) / distance)))

	useLayoutEffect(() => {
		if (!scrollElement || !anchor) {
			pinnedRef.current = false
			setPinned(false)
			settledRef.current = false
			setSettled(false)
			return
		}

		let scrollFrame = 0
		let measureFrame = 0

		const syncScroll = () => {
			const nextScrollY = scrollElement.scrollTop
			scrollY.set(nextScrollY)

			const threshold = stickStart.get() - (pinnedRef.current ? PIN_HYSTERESIS : 0)
			const nextPinned = nextScrollY >= threshold
			if (nextPinned !== pinnedRef.current) {
				pinnedRef.current = nextPinned
				setPinned(nextPinned)
			}

			const settleThreshold = stickStart.get() + distance
			const nextSettled = nextScrollY >= settleThreshold
			if (nextSettled !== settledRef.current) {
				settledRef.current = nextSettled
				setSettled(nextSettled)
			}
		}

		const measure = () => {
			const viewportTop = scrollElement.getBoundingClientRect().top
			const anchorTop = anchor.getBoundingClientRect().top
			stickStart.set(Math.max(0, anchorTop - viewportTop + scrollElement.scrollTop))
			syncScroll()
		}

		const scheduleScrollSync = () => {
			if (scrollFrame) return
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = 0
				syncScroll()
			})
		}
		const scheduleMeasure = () => {
			if (measureFrame) return
			measureFrame = requestAnimationFrame(() => {
				measureFrame = 0
				measure()
			})
		}

		measure()
		// Scroll restoration runs against the persistent viewport after route
		// rendering, so read its final position again on the next frame.
		scheduleScrollSync()
		scrollElement.addEventListener('scroll', scheduleScrollSync, {passive: true})
		window.addEventListener('resize', scheduleMeasure)

		const resizeObserver = new ResizeObserver(scheduleMeasure)
		resizeObserver.observe(scrollElement)
		resizeObserver.observe(anchor)
		if (anchor.parentElement) resizeObserver.observe(anchor.parentElement)

		return () => {
			scrollElement.removeEventListener('scroll', scheduleScrollSync)
			window.removeEventListener('resize', scheduleMeasure)
			resizeObserver.disconnect()
			cancelAnimationFrame(scrollFrame)
			cancelAnimationFrame(measureFrame)
		}
	}, [anchor, scrollElement, scrollY, stickStart])

	return {progress, wrapperY, pinned, settled}
}
