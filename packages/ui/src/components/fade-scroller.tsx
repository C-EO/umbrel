import {ComponentPropsWithoutRef, useLayoutEffect, useRef} from 'react'
import {mergeRefs} from 'react-merge-refs'

export type FadeScrollerProps = ComponentPropsWithoutRef<'div'> & {
	direction: 'x' | 'y'
	debug?: boolean
	/** Fade depth in px per scrollable edge. The 50px default suits wide rails;
	 * compact scrollers (e.g. breadcrumbs) pass something smaller so the fade
	 * doesn't swallow most of the visible content. */
	fadeSize?: number
	ref?: React.Ref<HTMLDivElement>
}

const FADE_SCROLLER_CLASS_X = 'umbrel-fade-scroller-x'
const FADE_SCROLLER_CLASS_Y = 'umbrel-fade-scroller-y'

export function useFadeScroller(direction: 'x' | 'y', debug?: boolean, fadeSize = 50) {
	const ref = useRef<HTMLDivElement>(null)

	// NOTE: useLayoutEffect is used to avoid flicker when fading is rendered
	useLayoutEffect(() => {
		// Horizontal scroll in chrome adds fading via scroll-timeline even when it shouldn't. This happens in the 3-up section of the app store
		// Animating in the side fades also doesn't work because the positions of the gradient markers would be based on the scroll position
		const el = ref!.current
		if (!el) return

		// Throttle scroll updates to once per frame via rAF to avoid redundant
		// style recalculations — scroll events can fire 10+ times per frame.
		let rafId = 0
		const updateFade = () => {
			if (!el) return

			// Round to avoid issues with sub-pixel scrolling
			// Using `<` and `>` to capture the edge case where the user scrolls past the end of the content (iOS bouncing)
			const atStart = direction === 'x' ? el.scrollLeft <= 0 : el.scrollTop <= 0
			const atEnd =
				direction === 'x'
					? Math.round(el.scrollLeft) + el.clientWidth >= el.scrollWidth
					: Math.round(el.scrollTop) + el.clientHeight >= el.scrollHeight

			if (atStart && atEnd) {
				el.style.setProperty('--distance1', `0px`)
				el.style.setProperty('--distance2', `0px`)
			} else if (atStart) {
				el.style.setProperty('--distance1', `0px`)
				el.style.setProperty('--distance2', `${fadeSize}px`)
			} else if (atEnd) {
				el.style.setProperty('--distance1', `${fadeSize}px`)
				el.style.setProperty('--distance2', `0px`)
			} else {
				el.style.setProperty('--distance1', `${fadeSize}px`)
				el.style.setProperty('--distance2', `${fadeSize}px`)
			}
		}

		const scheduleUpdate = () => {
			if (rafId) return
			rafId = requestAnimationFrame(() => {
				rafId = 0
				updateFade()
			})
		}

		// Run on mount by default
		updateFade()

		// The scroll range can change without a scroll event. Observe every direct
		// child, and keep that set synchronized when dynamic lists replace content.
		const observedChildren = new Set<Element>()
		const resizeObserver = new ResizeObserver(scheduleUpdate)
		const syncObservedChildren = () => {
			const currentChildren = new Set(el.children)
			for (const child of observedChildren) {
				if (!currentChildren.has(child)) {
					resizeObserver.unobserve(child)
					observedChildren.delete(child)
				}
			}
			for (const child of currentChildren) {
				if (!observedChildren.has(child)) {
					resizeObserver.observe(child)
					observedChildren.add(child)
				}
			}
		}

		resizeObserver.observe(el)
		syncObservedChildren()
		const mutationObserver = new MutationObserver(() => {
			syncObservedChildren()
			scheduleUpdate()
		})
		mutationObserver.observe(el, {childList: true})

		el.addEventListener('scroll', scheduleUpdate, {passive: true})
		return () => {
			el.removeEventListener('scroll', scheduleUpdate)
			mutationObserver.disconnect()
			resizeObserver.disconnect()
			cancelAnimationFrame(rafId)
		}
	}, [direction, fadeSize])

	const scrollerClass =
		direction === 'x' ? FADE_SCROLLER_CLASS_X : direction === 'y' ? FADE_SCROLLER_CLASS_Y : undefined

	return {scrollerClass, ref}
}

export function FadeScroller({direction, debug, fadeSize, className, ref, ...props}: FadeScrollerProps) {
	const {scrollerClass, ref: scrollerRef} = useFadeScroller(direction, debug, fadeSize)

	return <div ref={mergeRefs([ref, scrollerRef])} className={scrollerClass + ' ' + className} {...props} />
}
