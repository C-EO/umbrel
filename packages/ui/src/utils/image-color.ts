// Pixel-level colour analysis, shared by the app-icon accent in Live Usage
// and the album covers in Photos. Everything here works on a small sample of
// the image: ~1k pixels carry its dominant hue as well as the full picture
// does, and keep the main-thread cost of a sample well under a millisecond.

export type Rgb = [r: number, g: number, b: number]
export type Hsl = [h: number, s: number, l: number] // all 0..1

export type Pixels = {data: Uint8ClampedArray; width: number; height: number}

/** Draws any decoded image source into a `size`×`size` canvas and returns its pixels */
export function samplePixels(source: CanvasImageSource, size = 32): Pixels {
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext('2d', {willReadFrequently: true})
	if (!ctx) throw new Error('canvas unavailable')
	ctx.drawImage(source, 0, 0, size, size)
	return ctx.getImageData(0, 0, size, size)
}

// Analyses run one at a time, each in its own idle slice, so a burst of
// images (a grid of icons or covers landing together) never decodes and
// quantizes several of them inside one long frame
let queue: Promise<unknown> = Promise.resolve()

const nextIdle = () =>
	new Promise<void>((resolve) => {
		if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), {timeout: 500})
		else setTimeout(resolve, 50)
	})

export function runWhenIdle<T>(task: () => T | Promise<T>): Promise<T> {
	const run = queue.then(nextIdle).then(task)
	// Keep the queue going whether or not this task fails
	queue = run.catch(() => {})
	return run
}

// Number of hue buckets for the dominant-hue histogram
const HUE_BUCKETS = 24

export type DominantChroma = {
	// Mean of the winning bucket's pixels, both ways
	rgb: Rgb
	hsl: Hsl
	// Share of all pixels that were chromatic and in the winning bucket
	share: number
}

/**
 * The hue that characterises an image: hues are bucketed and weighted by
 * saturation, so a vivid subject beats a large washed-out background, and
 * neutral pixels (near black, near white, grey) never take part. Returns
 * undefined when too little of the image is chromatic at all — a verdict the
 * caller should treat as "this image has no colour", not as a failure.
 */
export function dominantChroma({data, width, height}: Pixels, {minShare = 0.04} = {}): DominantChroma | undefined {
	const weight = new Array<number>(HUE_BUCKETS).fill(0)
	const sums = Array.from({length: HUE_BUCKETS}, () => ({r: 0, g: 0, b: 0, h: 0, s: 0, l: 0, n: 0}))
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3]! < 128) continue // transparent
		const r = data[i]!
		const g = data[i + 1]!
		const b = data[i + 2]!
		const [h, s, l] = rgbToHsl(r, g, b)
		if (l < 0.08 || l > 0.95 || s < 0.25) continue // neutral-ish pixels
		const bucket = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS))
		weight[bucket]! += s
		const sum = sums[bucket]!
		sum.r += r
		sum.g += g
		sum.b += b
		sum.h += h
		sum.s += s
		sum.l += l
		sum.n++
	}
	let best = -1
	for (let bucket = 0; bucket < HUE_BUCKETS; bucket++) {
		if (weight[bucket]! > (best === -1 ? 0 : weight[best]!)) best = bucket
	}
	if (best === -1) return undefined
	const {r, g, b, h, s, l, n} = sums[best]!
	const share = n / (width * height)
	if (share < minShare) return undefined
	return {rgb: [r / n, g / n, b / n], hsl: [h / n, s / n, l / n], share}
}

/** Mean colour and mean relative luminance (linear, 0..1) of the rows from `fromRow` up to `toRow` */
export function regionStats({data, width}: Pixels, fromRow: number, toRow: number): {rgb: Rgb; luminance: number} {
	let r = 0
	let g = 0
	let b = 0
	let luminance = 0
	let n = 0
	for (let i = fromRow * width * 4; i < toRow * width * 4; i += 4) {
		r += data[i]!
		g += data[i + 1]!
		b += data[i + 2]!
		luminance += 0.2126 * linear(data[i]!) + 0.7152 * linear(data[i + 1]!) + 0.0722 * linear(data[i + 2]!)
		n++
	}
	return n === 0 ? {rgb: [0, 0, 0], luminance: 0} : {rgb: [r / n, g / n, b / n], luminance: luminance / n}
}

const linear = (channel: number) => {
	const c = channel / 255
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * sRGB → OKLCH. Unlike HSL, OKLCH's lightness and chroma are perceptually
 * even across hues, so a colour re-lit to a fixed lightness reads as equally
 * bright whether it's yellow or blue — what you want when picking a text
 * colour from an image.
 */
export function rgbToOklch(r: number, g: number, b: number): {l: number; c: number; h: number} {
	const lr = linear(r)
	const lg = linear(g)
	const lb = linear(b)
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	const c = Math.hypot(a, bb)
	const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
	return {l: L, c, h}
}

/**
 * OKLCH → sRGB, as a CSS `rgb()` string (with alpha when given). A colour
 * outside the sRGB gamut has its chroma reduced until it fits — the same
 * hue and lightness, slightly less vivid — rather than clipped per channel,
 * which shifts the hue. Plain rgb() so every browser paints it the same,
 * gradients included.
 */
export function oklchToCss(l: number, c: number, h: number, alpha?: number) {
	let rgb = oklchToLinear(l, c, h)
	for (let chroma = c; !inGamut(rgb) && chroma > 0; chroma = Math.max(0, chroma - 0.005)) {
		rgb = oklchToLinear(l, chroma, h)
	}
	const [r, g, b] = rgb.map((channel) => Math.round(gamma(Math.min(1, Math.max(0, channel))) * 255))
	return alpha === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha.toFixed(2)})`
}

function oklchToLinear(L: number, c: number, h: number): Rgb {
	const a = c * Math.cos((h * Math.PI) / 180)
	const b = c * Math.sin((h * Math.PI) / 180)
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	]
}

const inGamut = (rgb: Rgb) => rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005)

const gamma = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)

/**
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
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
