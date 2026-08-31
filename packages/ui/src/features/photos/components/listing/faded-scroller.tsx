import {useEffect, useRef, useState, type ComponentPropsWithoutRef, type Ref} from 'react'
import {mergeRefs} from 'react-merge-refs'

import type {Frame} from '@/features/photos/components/listing/surface'
import {cn} from '@/lib/utils'

// Whether scrollbars take layout space here (Windows, Linux, a Mac set to
// always show them). Only then is a gutter worth reserving: WebKit reserves
// one for its overlay scrollbars too, which take no space, and the strip
// sat blank down the right of every phone. Probed once.
let classicScrollbars: boolean | undefined
function hasClassicScrollbars() {
	if (classicScrollbars === undefined) {
		const probe = document.createElement('div')
		probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
		document.body.append(probe)
		classicScrollbars = probe.offsetWidth - probe.clientWidth > 0
		probe.remove()
	}
	return classicScrollbars
}

// A listing's scroller: fills its surface, and what scrolls up under the
// actions bar floating over it dissolves into the window (the mask in
// .umbrel-photos-scroller, fed the frame). A classic scrollbar is measured
// so the mask can leave it alone, and the content already keeps clear of it
// — its gutter is reserved so it can't come and go with the content and
// resize the grid (see .umbrel-photos-scroller); with overlay scrollbars
// there is nothing to reserve.
export function FadedScroller({
	frame,
	ref,
	className,
	style,
	children,
	...props
}: ComponentPropsWithoutRef<'div'> & {frame: Frame; ref?: Ref<HTMLDivElement>}) {
	const ownRef = useRef<HTMLDivElement>(null)
	const [scrollbar, setScrollbar] = useState(0)
	// Settled in the first render, so the grid never lays out for a gutter it won't have
	const [gutter] = useState(() => (hasClassicScrollbars() ? 'stable' : 'auto'))
	useEffect(() => {
		const el = ownRef.current
		if (!el) return
		const measure = () => setScrollbar(el.offsetWidth - el.clientWidth)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	return (
		<div
			ref={mergeRefs([ref, ownRef])}
			className={cn(
				'umbrel-photos-scroller h-full w-full overflow-x-hidden overflow-y-auto overscroll-contain',
				className,
			)}
			data-scrollbar={scrollbar > 0 ? '' : undefined}
			style={{
				['--umbrel-photos-fade-from' as string]: `${frame.fadeFrom}px`,
				['--umbrel-photos-fade-to' as string]: `${frame.fadeTo}px`,
				['--umbrel-photos-scrollbar' as string]: `${scrollbar}px`,
				// Focus and scrollIntoView bring things out from under the (pinned) bar
				scrollPaddingTop: frame.fadeTo,
				scrollbarGutter: gutter,
				...style,
			}}
			{...props}
		>
			{children}
		</div>
	)
}
