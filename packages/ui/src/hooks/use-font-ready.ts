import {useEffect, useState} from 'react'

// Fonts (and font + text pairs, since a face split by unicode-range only
// fetches the files a text needs) known to be loaded, so later renders don't
// hide anything
const ready = new Set<string>()

/**
 * Whether a web font is loaded for `text` — so a display face can be revealed
 * in its final form instead of swapping in over a fallback. Resolves true when
 * the font can't be loaded at all (the fallback is then what there is).
 */
export function useFontReady(font: string, text: string) {
	const key = `${font}|${text}`
	const [loaded, setLoaded] = useState(() => ready.has(key))

	useEffect(() => {
		if (ready.has(key)) return setLoaded(true)
		if (typeof document === 'undefined' || !('fonts' in document)) return setLoaded(true)
		let cancelled = false
		const done = () => {
			ready.add(key)
			if (!cancelled) setLoaded(true)
		}
		document.fonts.load(font, text).then(done, done)
		return () => {
			cancelled = true
		}
	}, [key, font, text])

	return loaded
}
