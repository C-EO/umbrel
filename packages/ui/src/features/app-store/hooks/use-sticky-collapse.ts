import {useMotionValue, useTransform, type MotionValue} from 'motion/react'
import {useLayoutEffect, useState} from 'react'

import {useSheetStickyHeader} from '@/providers/sheet-sticky-header'

/**
 * Scroll progress (0 → 1 over `distance`px) of a sticky wrapper collapsing
 * against the top of the sheet's scroller — shared by the store header and
 * the app page hero. Built to be correct at any mount time:
 *
 * - The scroll position is owned here and synced from the container at mount
 *   (and again a frame later, after any scroll restoration has applied), so
 *   chrome mounting into an already-scrolled page renders its correct state
 *   immediately instead of waiting for the next scroll event.
 * - The pin offset is measured from the wrapper's NEXT SIBLING, not the
 *   wrapper itself: a stuck wrapper's rect is pinned to the viewport and
 *   reads wrong, but siblings stay in normal flow — subtracting the flex row
 *   gap and the wrapper's height from the sibling's content offset gives the
 *   wrapper's natural position in every scroll state.
 */
export function useStickyCollapse(
	wrapperRef: React.RefObject<HTMLDivElement | null>,
	distance: number,
): MotionValue<number> {
	const {scrollRef} = useSheetStickyHeader()
	const scrollY = useMotionValue(0)
	const [stickStart, setStickStart] = useState(0)

	useLayoutEffect(() => {
		const scroller = scrollRef?.current
		const wrapper = wrapperRef.current
		if (!scroller || !wrapper) return

		let frame = 0
		const sync = () => {
			scrollY.set(scroller.scrollTop)
			const parent = wrapper.parentElement
			const sibling = wrapper.nextElementSibling
			if (!parent || !sibling) return
			const gap = parseFloat(getComputedStyle(parent).rowGap) || 0
			setStickStart(
				Math.max(
					0,
					Math.round(
						sibling.getBoundingClientRect().top -
							scroller.getBoundingClientRect().top +
							scroller.scrollTop -
							gap -
							wrapper.offsetHeight,
					),
				),
			)
		}
		const scheduleSync = () => {
			if (frame) return
			frame = requestAnimationFrame(() => {
				frame = 0
				sync()
			})
		}

		sync()
		// Once more next frame, after any scroll restoration has applied
		scheduleSync()
		scroller.addEventListener('scroll', scheduleSync, {passive: true})
		window.addEventListener('resize', scheduleSync)
		// The wrapper's height can change without a scroll (search hides the rail)
		const observer = new ResizeObserver(scheduleSync)
		observer.observe(wrapper)
		return () => {
			scroller.removeEventListener('scroll', scheduleSync)
			window.removeEventListener('resize', scheduleSync)
			observer.disconnect()
			cancelAnimationFrame(frame)
		}
	}, [scrollRef, wrapperRef, scrollY])

	return useTransform(scrollY, [stickStart, stickStart + distance], [0, 1], {clamp: true})
}
