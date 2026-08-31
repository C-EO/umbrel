import ColorThief, {RGBColor} from 'colorthief'
import {useEffect, useState, type RefObject} from 'react'
import {useIntersection} from 'react-use'

import {dominantChroma, rgbToHsl, runWhenIdle, samplePixels} from '@/utils/image-color'

const colorThief = new ColorThief()
const colorCount = 3

export function useColorThief(ref: React.RefObject<HTMLImageElement | null>) {
	const [colors, setColors] = useState<string[] | undefined>()

	const intersection = useIntersection(ref as RefObject<HTMLImageElement>, {
		root: null,
		rootMargin: '0px',
		threshold: 0,
	})

	useEffect(() => {
		if (!ref.current) return
		if (!intersection) return
		if (intersection.intersectionRatio === 0) return

		const img = ref.current

		const handleLoad = () => {
			try {
				const rgbArr = colorThief.getPalette(img, colorCount)
				setColors(processColors(rgbArr))
			} catch {
				setColors(undefined) // Reset colors on error
			}
		}

		const handleError = () => {
			setColors(undefined) // Reset colors on image load error
		}

		if (img.complete) {
			handleLoad()
		} else {
			img.addEventListener('load', handleLoad)
			img.addEventListener('error', handleError)
		}

		// Cleanup function
		return () => {
			img.removeEventListener('load', handleLoad)
			img.removeEventListener('error', handleError)
		}
	}, [intersection, ref])

	return colors
}

// Module-level cache so extraction runs once per icon per session
const accentColorCache = new Map<string, Promise<string | undefined>>()

/**
 * Extracts a legible accent color from an app icon: keeps the icon's dominant
 * hue but clamps saturation and lightness so small UI elements (bar segments,
 * mini bars) stay readable on a dark background. Resolves undefined for
 * neutral (black/white/gray) icons — a deterministic verdict that stays cached
 * — while load/canvas errors are transient (offline blip, missing CORS
 * headers) and evict the cache entry so a later call retries.
 */
export function extractIconAccentColor(iconUrl: string): Promise<string | undefined> {
	let pending = accentColorCache.get(iconUrl)
	if (!pending) {
		pending = runWhenIdle(() => extractAccentColor(iconUrl)).catch(() => {
			accentColorCache.delete(iconUrl)
			return undefined
		})
		accentColorCache.set(iconUrl, pending)
	}
	return pending
}

// Chromatic pixels must cover at least this share of the icon to call it non-neutral
const MIN_CHROMATIC_SHARE = 0.04

/** Resolves undefined for neutral icons; throws on load/canvas errors. */
async function extractAccentColor(iconUrl: string): Promise<string | undefined> {
	const img = new Image()
	img.crossOrigin = 'anonymous'
	img.src = iconUrl
	await img.decode()

	const dominant = dominantChroma(samplePixels(img), {minShare: MIN_CHROMATIC_SHARE})
	if (!dominant) return undefined

	// Keep the icon's hue but clamp saturation and lightness so small UI
	// elements (bar segments, mini bars) stay readable on a dark background
	const [hue, saturation, lightness] = dominant.hsl
	const h = Math.round(hue * 360)
	const s = Math.round(Math.max(saturation, 0.6) * 100)
	const l = Math.round(Math.min(Math.max(lightness, 0.55), 0.68) * 100)
	return `hsl(${h} ${s}% ${l}%)`
}

function processColors(colors: RGBColor[] | null) {
	// TODO: consider pulling out hues and always set saturation to 100% and lightness to 50%
	if (!colors) return undefined
	return colors
		.filter((c) => !isNeutralBright(c) && !isNeutralDark(c))
		.map((c) => {
			const [h, s, l] = rgbToHsl(c[0], c[1], c[2])
			const hslCss = `hsla(${h * 360}, ${s * 80 + 20}%, ${l * 10 + 30}%, 0.8)`
			return hslCss
		})
}

function isNeutralBright(rgb: number[]) {
	if (rgb[0] > 200 && rgb[1] > 200 && rgb[2] > 200) {
		return true
		// return `rgba(${rgb.map((c) => c / 3).join(',')}, 0.5)`
	}
	return false
}

function isNeutralDark(rgb: number[]) {
	if (rgb[0] < 55 && rgb[1] < 55 && rgb[2] < 55) {
		return true
	}
	return false
}
