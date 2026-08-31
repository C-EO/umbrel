import {useEffect, useState, type RefObject} from 'react'

// Content-box size of an element, kept current with a ResizeObserver.
//
// Uses clientWidth/clientHeight minus padding rather than getBoundingClientRect:
// client* are layout values and ignore ancestor CSS transforms, so a container
// inside the sheet's zoom-in animation measures its final size on first paint
// instead of a scaled-down one.
export function useContainerSize(ref: RefObject<HTMLElement | null>) {
	const [size, setSize] = useState({width: 0, height: 0})

	useEffect(() => {
		const el = ref.current
		if (!el) return

		const measure = () => {
			const style = getComputedStyle(el)
			const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
			const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
			setSize((prev) => (prev.width === width && prev.height === height ? prev : {width, height}))
		}

		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [ref])

	return size
}
