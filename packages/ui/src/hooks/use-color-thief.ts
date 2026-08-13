import ColorThief, {RGBColor} from 'colorthief'
import {useEffect, useState, type RefObject} from 'react'
import {useIntersection} from 'react-use'

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

// Extractions run one at a time, each in its own idle slice, so a burst of
// icons (e.g. Live Usage opening over its entrance animation) never decodes
// and quantizes multiple images inside one long frame
let extractionQueue: Promise<unknown> = Promise.resolve()

const nextIdle = () =>
	new Promise<void>((resolve) => {
		if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), {timeout: 500})
		else setTimeout(resolve, 50)
	})

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
		pending = extractionQueue
			.then(nextIdle)
			.then(() => extractAccentColor(iconUrl))
			.catch(() => {
				accentColorCache.delete(iconUrl)
				return undefined
			})
		extractionQueue = pending
		accentColorCache.set(iconUrl, pending)
	}
	return pending
}

// Number of hue buckets for the dominant-hue histogram
const HUE_BUCKETS = 24
// Chromatic pixels must cover at least this share of the icon to call it non-neutral
const MIN_CHROMATIC_SHARE = 0.04

/** Resolves undefined for neutral icons; throws on load/canvas errors. */
async function extractAccentColor(iconUrl: string): Promise<string | undefined> {
	const img = new Image()
	img.crossOrigin = 'anonymous'
	img.src = iconUrl
	await img.decode()

	// Downscale before sampling: ~1k pixels carry the dominant hue just as well
	// as a full-size icon and keep the main-thread work sub-millisecond
	const size = 32
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext('2d', {willReadFrequently: true})
	if (!ctx) throw new Error('canvas unavailable')
	ctx.drawImage(img, 0, 0, size, size)
	const {data} = ctx.getImageData(0, 0, size, size)

	// Bucket hues weighted by saturation so brand colors beat washed
	// backgrounds, then average the winning bucket's saturation and lightness
	const weight = new Array<number>(HUE_BUCKETS).fill(0)
	const hSum = new Array<number>(HUE_BUCKETS).fill(0)
	const sSum = new Array<number>(HUE_BUCKETS).fill(0)
	const lSum = new Array<number>(HUE_BUCKETS).fill(0)
	const count = new Array<number>(HUE_BUCKETS).fill(0)
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 128) continue // transparent
		const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
		if (l < 0.08 || l > 0.95 || s < 0.25) continue // neutral-ish pixels
		const bucket = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS))
		weight[bucket] += s
		hSum[bucket] += h
		sSum[bucket] += s
		lSum[bucket] += l
		count[bucket]++
	}
	let best = -1
	for (let bucket = 0; bucket < HUE_BUCKETS; bucket++) {
		if (weight[bucket] > (best === -1 ? 0 : weight[best])) best = bucket
	}
	if (best === -1 || count[best] < size * size * MIN_CHROMATIC_SHARE) return undefined

	const h = Math.round((hSum[best] / count[best]) * 360)
	const s = Math.round(Math.max(sSum[best] / count[best], 0.6) * 100)
	const l = Math.round(Math.min(Math.max(lSum[best] / count[best], 0.55), 0.68) * 100)
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

/**
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 *
 * @param   {number}  r       The red color value
 * @param   {number}  g       The green color value
 * @param   {number}  b       The blue color value
 * @return  {Array}           The HSL representation
 */
function rgbToHsl(r: number, g: number, b: number) {
	const {min, max} = Math

	r /= 255
	g /= 255
	b /= 255
	const vmax = max(r, g, b),
		vmin = min(r, g, b)
	let h = 0
	const l = (vmax + vmin) / 2

	if (vmax === vmin) {
		return [0, 0, l] // achromatic
	}

	const d = vmax - vmin
	const s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin)
	if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0)
	if (vmax === g) h = (b - r) / d + 2
	if (vmax === b) h = (r - g) / d + 4
	h /= 6

	return [h, s, l]
}
