import {useCallback, useEffect, useRef, useState} from 'react'

import {coverTone, DEFAULT_TONE, type CoverTone} from '@/features/photos/components/albums/cover-tone'
import {runWhenIdle, samplePixels} from '@/utils/image-color'

// One analysis per cover per session. Keyed by the URL the browser actually
// loaded, so every card showing the same cover shares the verdict.
const tones = new Map<string, CoverTone>()

// The caption waits for its cover so the two appear together, already in the
// final colour — but never longer than this, so a cover that fails to arrive
// still leaves a titled card
const REVEAL_TIMEOUT_MS = 1500

/**
 * The tone of a card's cover: hand `onLoad` to the cover image. `ready` turns
 * true once the tone is known (or there's no cover to wait for, or waiting
 * would take too long).
 */
export function useCoverTone(hasCover: boolean) {
	const [tone, setTone] = useState<CoverTone | undefined>()
	const [timedOut, setTimedOut] = useState(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])

	useEffect(() => {
		if (!hasCover) return
		const timer = setTimeout(() => setTimedOut(true), REVEAL_TIMEOUT_MS)
		return () => clearTimeout(timer)
	}, [hasCover])

	const onLoad = useCallback((img: HTMLImageElement) => {
		const key = img.currentSrc
		const known = tones.get(key)
		if (known) return setTone(known)
		runWhenIdle(() => coverTone(samplePixels(img)))
			.catch(() => DEFAULT_TONE)
			.then((result) => {
				tones.set(key, result)
				if (mounted.current) setTone(result)
			})
	}, [])

	return {tone: tone ?? DEFAULT_TONE, ready: !hasCover || tone !== undefined || timedOut, onLoad}
}
