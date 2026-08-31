import {describe, expect, it} from 'vitest'

import {oklchToCss, rgbToOklch, type Pixels} from '@/utils/image-color'

import {coverTone} from './cover-tone'

// Back from a CSS rgb() string to OKLCH, for checking what a colour is
function oklchOf(css: string) {
	const [r, g, b, alpha] = css.match(/[\d.]+/g)!.map(Number)
	return {...rgbToOklch(r!, g!, b!), alpha}
}

// The colour a scrim gradient starts from, at the bottom edge
const bottomOf = (scrim: string) => scrim.match(/rgb\([^)]+\)/)![0]

// Hues of dark or pale colours are coarse once rounded to 8-bit channels
const expectHue = (actual: number, expected: number) =>
	expect(Math.min(Math.abs(actual - expected), 360 - Math.abs(actual - expected))).toBeLessThan(12)

// A `size`×`size` image painted by a function of row and column
function paint(size: number, pixel: (row: number, col: number) => [number, number, number]): Pixels {
	const data = new Uint8ClampedArray(size * size * 4)
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const i = (row * size + col) * 4
			const [r, g, b] = pixel(row, col)
			data[i] = r
			data[i + 1] = g
			data[i + 2] = b
			data[i + 3] = 255
		}
	}
	return {data, width: size, height: size}
}

describe('rgbToOklch / oklchToCss', () => {
	it('matches the reference values', () => {
		const white = rgbToOklch(255, 255, 255)
		expect(white.l).toBeCloseTo(1, 3)
		expect(white.c).toBeCloseTo(0, 3)
		const red = rgbToOklch(255, 0, 0)
		expect(red.l).toBeCloseTo(0.628, 2)
		expect(red.c).toBeCloseTo(0.258, 2)
		expect(red.h).toBeCloseTo(29.2, 0)
		const blue = rgbToOklch(0, 0, 255)
		expect(blue.h).toBeCloseTo(264.1, 0)
	})

	it('round-trips, and formats as plain rgb()', () => {
		expect(oklchToCss(1, 0, 0)).toBe('rgb(255 255 255)')
		const red = rgbToOklch(255, 0, 0)
		expect(oklchToCss(red.l, red.c, red.h)).toBe('rgb(255 0 0)')
		expect(oklchToCss(0.5, 0.1, 200, 0.5)).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.50\)$/)
		const {l, c, h} = oklchOf(oklchToCss(0.7, 0.08, 120))
		expect(l).toBeCloseTo(0.7, 2)
		expect(c).toBeCloseTo(0.08, 2)
		expect(h).toBeCloseTo(120, 0)
	})

	it('brings an out-of-gamut colour in by reducing chroma, keeping its hue', () => {
		// Light, vivid blue: no such colour in sRGB
		const {l, c, h} = oklchOf(oklchToCss(0.88, 0.2, 264))
		expect(l).toBeCloseTo(0.88, 1)
		expect(c).toBeLessThan(0.2)
		expect(c).toBeGreaterThan(0.05)
		expectHue(h, 264)
	})
})

describe('coverTone', () => {
	it('tints the title with the cover’s hue, re-lit to a fixed lightness', () => {
		const sea = oklchOf(coverTone(paint(32, () => [20, 120, 200])).tint!)
		expect(sea.l).toBeCloseTo(0.88, 1)
		// As vivid as sRGB allows for a light blue (well under the 0.11 cap)
		expect(sea.c).toBeGreaterThan(0.05)
		expect(sea.c).toBeLessThan(0.11)
		expectHue(sea.h, rgbToOklch(20, 120, 200).h)
		// A light green fits at full strength
		const grass = oklchOf(coverTone(paint(32, () => [40, 190, 60])).tint!)
		expect(grass.c).toBeCloseTo(0.11, 2)
		expectHue(grass.h, rgbToOklch(40, 190, 60).h)
	})

	it('goes paler for a muted cover, and white for a neutral one', () => {
		const muted = oklchOf(coverTone(paint(32, () => [170, 120, 90])).tint!)
		expect(muted.c).toBeGreaterThan(0.04)
		expect(muted.c).toBeLessThan(0.1)
		expect(coverTone(paint(32, () => [128, 128, 128])).tint).toBeUndefined()
		// One vivid sign in a grey street is not the street's colour
		expect(coverTone(paint(32, (row, col) => (row < 2 && col < 16 ? [255, 0, 0] : [90, 90, 90]))).tint).toBeUndefined()
	})

	it('lets the subject beat a bigger, washed-out background', () => {
		const tone = coverTone(paint(32, (row) => (row < 8 ? [230, 40, 40] : [180, 190, 200])))
		expectHue(oklchOf(tone.tint!).h, rgbToOklch(230, 40, 40).h)
	})

	it('shades the scrim in the colour under the caption, darker under a bright edge', () => {
		const snowy = coverTone(paint(32, (row) => (row < 20 ? [40, 60, 90] : [250, 250, 255])))
		const dusk = coverTone(paint(32, () => [20, 20, 30]))
		const sea = coverTone(paint(32, () => [20, 120, 200]))
		expect(oklchOf(bottomOf(snowy.scrim)).alpha).toBeGreaterThan(0.99)
		expect(oklchOf(bottomOf(dusk.scrim)).alpha).toBeLessThan(0.95)
		// Deep, barely coloured, in the sea's own hue, easing out upwards
		const shade = oklchOf(bottomOf(sea.scrim))
		expect(shade.l).toBeCloseTo(0.18, 1)
		expect(shade.c).toBeLessThan(0.06)
		expectHue(shade.h, rgbToOklch(20, 120, 200).h)
		expect(sea.scrim).toMatch(
			/^linear-gradient\(to top, rgb\([\d ]+ \/ 0\.\d\d\) 0%, .* 45%, .* 73%, rgb\([\d ]+ \/ 0\.00\) 100%\)$/,
		)
	})
})
