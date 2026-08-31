// What an album cover tells the caption drawn over it: a text colour carrying
// the image's own hue, and the scrim beneath the text — in the colour the
// image already has there, as dark as legibility needs.

import {dominantChroma, oklchToCss, regionStats, rgbToOklch, type Pixels} from '@/utils/image-color'

export type CoverTone = {
	// CSS colour for the title, or undefined for plain white (a neutral cover)
	tint?: string
	// CSS background image: the gradient behind the caption
	scrim: string
	// The scrim's own colour at full depth, opaque — for chrome that should
	// match the darkening (the card's options button)
	shade: string
}

// The scrim is a deep shade of whatever colour the image has under the
// caption — so it reads as the picture darkening, not as a grey film. It is
// a band, not a haze: solid across the caption (the bottom quarter of the
// card), fading over the next 30%, and gone above 55% so the upper half of
// the cover stays untouched. `alpha` is its strength at the bottom edge.
export function scrimGradient(color: (alpha: number) => string, alpha: number) {
	const stop = (fraction: number, at: number) => `${color(alpha * fraction)} ${at}%`
	// The band spans the bottom 55% of the card, so in card terms: solid over
	// the bottom quarter, half strength at 40%, gone at 55%
	return `linear-gradient(to top, ${stop(1, 0)}, ${stop(0.95, 45)}, ${stop(0.5, 73)}, ${stop(0, 100)})`
}

export const DEFAULT_TONE: CoverTone = {
	scrim: scrimGradient((alpha) => `rgb(0 0 0 / ${alpha.toFixed(2)})`, 0.95),
	shade: 'rgb(0 0 0)',
}

// The title is always this light — legibility over the scrim never depends on
// the image — and only as colourful as a tint, never neon
const TINT_LIGHTNESS = 0.88
const TINT_CHROMA = {min: 0.05, max: 0.11}
// A cover needs this much colour before its title picks it up: a mostly grey
// street with one red sign stays white
const MIN_CHROMATIC_SHARE = 0.08
// The shade under the caption: deep, barely coloured, stronger over a
// brighter image
const SHADE_LIGHTNESS = 0.18
const SHADE_MAX_CHROMA = 0.05
const SCRIM_ALPHA = {min: 0.92, max: 1}
const CAPTION_FROM = 0.6 // fraction of the height where the caption region starts

export function coverTone(pixels: Pixels): CoverTone {
	const dominant = dominantChroma(pixels, {minShare: MIN_CHROMATIC_SHARE})
	let tint: string | undefined
	if (dominant) {
		const {c, h} = rgbToOklch(...dominant.rgb)
		tint = oklchToCss(TINT_LIGHTNESS, Math.min(TINT_CHROMA.max, Math.max(TINT_CHROMA.min, c)), h)
	}
	const bottom = regionStats(pixels, Math.floor(pixels.height * CAPTION_FROM), pixels.height)
	const shade = rgbToOklch(...bottom.rgb)
	const alpha = SCRIM_ALPHA.min + (SCRIM_ALPHA.max - SCRIM_ALPHA.min) * Math.sqrt(bottom.luminance)
	const shadeColor = (a?: number) => oklchToCss(SHADE_LIGHTNESS, Math.min(SHADE_MAX_CHROMA, shade.c), shade.h, a)
	const scrim = scrimGradient(shadeColor, alpha)
	return {tint, scrim, shade: shadeColor()}
}
