import {useReducedMotion} from 'motion/react'
import {useEffect, useRef} from 'react'

import {cn} from '@/lib/utils'

// Concentric rings rippling outward from the center — the visual for "your
// Umbrel is broadcasting, listening for an agent". The fragment shader is
// MagicRings from reactbits.dev, re-hosted on a raw WebGL quad so it costs no
// three.js dependency. Colors ease between variants in the render loop, so the
// enabling→waiting→connected journey melts gray into the brand color (read
// from the wallpaper's --color-brand variables) into green rather than
// snapping.
//
// The shader is used as part of umbrelOS under ReactBits' license (MIT +
// Commons Clause License Condition v1.0), which requires retaining this
// notice:
//
//   Copyright (c) 2026 David Haz
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish, and
//   distribute the Software as part of an application, website, or product,
//   subject to the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial portions
//   of the Software.
//
//   Commons Clause Restriction: You may use this Software, including for any
//   commercial purpose, so long as you do not sell, sublicense, or
//   redistribute the components themselves — whether alone, in a bundle, or
//   as a ported version.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
//   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
//   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
//   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
//   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRingGap;
uniform float uFadeIn, uFadeOut, uUnit;
uniform vec2 uResolution;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / uUnit;
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  vec3 c = vec3(0.0);
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    c = mix(c, rc, vec3(ring(p, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
  }
  float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uNoiseAmount;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)) * uOpacity);
}
`

export type MagicRingsVariant = 'neutral' | 'brand' | 'success'

type Rgb = [number, number, number]

// "259 100% 59%" (the raw --color-brand triplet) → RGB in 0..1
function hslTripletToRgb(triplet: string): Rgb | null {
	const match = /([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/.exec(triplet)
	if (!match) return null
	const h = Number(match[1]) / 360
	const s = Number(match[2]) / 100
	const l = Number(match[3]) / 100
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s
	const p = 2 * l - q
	const channel = (t: number) => {
		t = ((t % 1) + 1) % 1
		if (t < 1 / 6) return p + (q - p) * 6 * t
		if (t < 1 / 2) return q
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
		return p
	}
	return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

function hexToRgb(hex: string): Rgb {
	const value = Number.parseInt(hex.slice(1), 16)
	return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

const NEUTRAL_COLORS: [Rgb, Rgb] = [hexToRgb('#71717c'), hexToRgb('#b4b4bd')]
const SUCCESS_COLORS: [Rgb, Rgb] = [hexToRgb('#4ade80'), hexToRgb('#a7f3d0')]
const BRAND_FALLBACK: [Rgb, Rgb] = [hexToRgb('#8265ff'), hexToRgb('#b8a8ff')]

export function MagicRings({
	variant,
	speed = 1,
	opacity = 0.8,
	className,
}: {
	variant: MagicRingsVariant
	speed?: number
	opacity?: number
	className?: string
}) {
	const reducedMotion = useReducedMotion() ?? false
	const mountRef = useRef<HTMLDivElement | null>(null)
	const redrawRef = useRef<(() => void) | null>(null)
	const loopRef = useRef<{start: () => void; stop: () => void} | null>(null)
	const stateRef = useRef({variant, speed, opacity, reducedMotion})
	stateRef.current = {variant, speed, opacity, reducedMotion}

	useEffect(() => {
		const mount = mountRef.current
		if (!mount) return

		const canvas = document.createElement('canvas')
		canvas.className = 'absolute inset-0 h-full w-full'
		const gl =
			canvas.getContext('webgl2', {alpha: true, premultipliedAlpha: false}) ??
			canvas.getContext('webgl', {alpha: true, premultipliedAlpha: false})
		if (!gl) return
		mount.appendChild(canvas)

		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type)!
			gl.shaderSource(shader, source)
			gl.compileShader(shader)
			return shader
		}
		const program = gl.createProgram()!
		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER))
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			mount.removeChild(canvas)
			return
		}
		gl.useProgram(program)

		const buffer = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		const position = gl.getAttribLocation(program, 'position')
		gl.enableVertexAttribArray(position)
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

		const uniform = (name: string) => gl.getUniformLocation(program, name)
		const uTime = uniform('uTime')
		const uResolution = uniform('uResolution')
		const uColor = uniform('uColor')
		const uColorTwo = uniform('uColorTwo')
		gl.uniform1f(uniform('uAttenuation'), 10)
		gl.uniform1f(uniform('uLineThickness'), 2)
		gl.uniform1f(uniform('uBaseRadius'), 0.22)
		// Enough rings, spaced widely enough, that the ripples sweep all the way
		// to the edges of a wide card (radii scale off the card's shorter side)
		gl.uniform1f(uniform('uRadiusStep'), 0.14)
		gl.uniform1f(uniform('uScaleRate'), 0.1)
		gl.uniform1f(uniform('uNoiseAmount'), 0.05)
		gl.uniform1f(uniform('uRingGap'), 1.5)
		gl.uniform1f(uniform('uFadeIn'), 0.7)
		gl.uniform1f(uniform('uFadeOut'), 0.5)
		gl.uniform1i(uniform('uRingCount'), 12)
		gl.uniform1f(uniform('uOpacity'), stateRef.current.opacity)

		// The brand vars hold raw HSL triplets that track the active wallpaper.
		// Re-read at most once a second, never per frame — getComputedStyle forces
		// a style recalc, and the values only move on a wallpaper change.
		let brandCache: {colors: [Rgb, Rgb]; at: number} | undefined
		const brandColors = (nowMs: number): [Rgb, Rgb] => {
			if (!brandCache || nowMs - brandCache.at > 1000) {
				const styles = getComputedStyle(mount)
				const base = hslTripletToRgb(styles.getPropertyValue('--color-brand'))
				const lighter = hslTripletToRgb(styles.getPropertyValue('--color-brand-lighter'))
				brandCache = {colors: base ? [base, lighter ?? base] : BRAND_FALLBACK, at: nowMs}
			}
			return brandCache.colors
		}
		const targetColors = (nowMs: number) => {
			const {variant} = stateRef.current
			return variant === 'success' ? SUCCESS_COLORS : variant === 'brand' ? brandColors(nowMs) : NEUTRAL_COLORS
		}

		// Colors ease toward the active variant's palette each frame, so phase
		// changes melt gray → brand → green instead of snapping
		const current: [Rgb, Rgb] = targetColors(0).map((color) => [...color]) as [Rgb, Rgb]
		const applyColors = (ease: number, nowMs: number) => {
			const target = targetColors(nowMs)
			for (let i = 0; i < 2; i++) {
				for (let c = 0; c < 3; c++) {
					current[i][c] += (target[i][c] - current[i][c]) * ease
				}
			}
			gl.uniform3f(uColor, current[0][0], current[0][1], current[0][2])
			gl.uniform3f(uColorTwo, current[1][0], current[1][1], current[1][2])
		}

		const renderFrame = (timeMs: number) => {
			applyColors(stateRef.current.reducedMotion ? 1 : 0.05, timeMs)
			gl.uniform1f(uTime, (timeMs / 1000) * stateRef.current.speed)
			gl.clearColor(0, 0, 0, 0)
			gl.clear(gl.COLOR_BUFFER_BIT)
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
		}
		redrawRef.current = () => renderFrame(1200)

		let frameId = 0
		let looping = false
		const animate = (timeMs: number) => {
			renderFrame(timeMs)
			frameId = requestAnimationFrame(animate)
		}
		loopRef.current = {
			start: () => {
				if (looping) return
				looping = true
				frameId = requestAnimationFrame(animate)
			},
			stop: () => {
				looping = false
				cancelAnimationFrame(frameId)
			},
		}

		const resize = () => {
			const dpr = Math.min(window.devicePixelRatio, 2)
			canvas.width = Math.max(1, mount.clientWidth * dpr)
			canvas.height = Math.max(1, mount.clientHeight * dpr)
			gl.viewport(0, 0, canvas.width, canvas.height)
			gl.uniform2f(uResolution, canvas.width, canvas.height)
			// Ring radii scale off a fixed reference rather than the card's own
			// size, so the rings hold their scale as the card morphs between its
			// enabling, waiting, and connected heights
			gl.uniform1f(uniform('uUnit'), 150 * dpr)
			// Reduced motion renders a single settled frame instead of looping
			if (stateRef.current.reducedMotion) renderFrame(1200)
		}
		resize()
		const observer = new ResizeObserver(resize)
		observer.observe(mount)

		return () => {
			loopRef.current?.stop()
			loopRef.current = null
			observer.disconnect()
			redrawRef.current = null
			mount.removeChild(canvas)
			gl.getExtension('WEBGL_lose_context')?.loseContext()
		}
	}, [])

	// The loop follows the live reduced-motion preference: pausing settles on
	// one final frame (also needed when the variant changes without a loop),
	// un-pausing resumes the ripples
	useEffect(() => {
		if (reducedMotion) {
			loopRef.current?.stop()
			redrawRef.current?.()
		} else {
			loopRef.current?.start()
		}
	}, [reducedMotion, variant])

	return <div ref={mountRef} aria-hidden className={cn('pointer-events-none absolute inset-0', className)} />
}
