// WebGL lens for Glass surfaces on browsers that can't refract the real
// backdrop (Safari/Firefox don't render backdrop-filter: url()). Where the
// backdrop is something we render ourselves — the desktop wallpaper <img> —
// the fragment shader computes the same rounded-rect SDF + Snell's-law dome
// bend as glass.tsx's displacement map, sampling the wallpaper texture per
// color channel for the chromatic fringe.

export type GlassLensParams = {
	scale: number
	chroma: number
	/** Rim width: fraction of the half min-dimension, or absolute '12px'. */
	bevel: number | string
	saturate: number
	brightness: number
	blur: number
}

/** Resolves a bevel prop to px for a w×h element (min 2px, like the map). */
export function resolveBevelPx(bevel: number | string, w: number, h: number): number {
	const px = typeof bevel === 'string' ? parseFloat(bevel) || 0 : bevel * (Math.min(w, h) / 2)
	return Math.max(2, px)
}

type LensSource = HTMLImageElement | HTMLVideoElement

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uRadius;
uniform float uBevel;
uniform float uScale;
uniform float uChroma;
uniform float uSaturate;
uniform float uBrightness;
uniform float uBlur;
uniform vec2 uUvOff;
uniform vec2 uUvStep;

const float IOR = 1.5;

vec2 lensDisp(vec2 p) {
  vec2 hs = uSize * 0.5;
  vec2 c = p - hs;
  vec2 q = abs(c) - (hs - vec2(uRadius));
  vec2 o = max(q, vec2(0.0));
  float sdf = length(o) + min(max(q.x, q.y), 0.0) - uRadius;
  if (sdf > 0.0 || -sdf > uBevel) return vec2(0.0);
  vec2 n;
  if (q.x > 0.0 && q.y > 0.0) {
    n = (o / max(length(o), 1e-4)) * sign(c);
  } else if (q.x > q.y) {
    n = vec2(sign(c.x), 0.0);
  } else {
    n = vec2(0.0, sign(c.y));
  }
  float u = -sdf / uBevel;
  float maxBend = cos(asin(1.0 / IOR));
  float bend = 1.0;
  if (u > 1e-4) {
    float slope = pow(1.0 - u, 3.0) / pow(1.0 - pow(1.0 - u, 4.0), 0.75);
    float thetaI = atan(slope);
    bend = sin(thetaI - asin(sin(thetaI) / IOR)) / maxBend;
  }
  return n * bend;
}

vec3 sampleGlass(vec2 p) {
  vec2 d = lensDisp(p);
  vec3 col;
  col.r = texture2D(uTex, uUvOff + (p + d * uScale * (1.0 + uChroma)) * uUvStep).r;
  col.g = texture2D(uTex, uUvOff + (p + d * uScale) * uUvStep).g;
  col.b = texture2D(uTex, uUvOff + (p + d * uScale * (1.0 - uChroma)) * uUvStep).b;
  return col;
}

void main() {
  vec2 p = vUv * uSize;
  vec3 col = sampleGlass(p);
  if (uBlur > 0.0) {
    float b = uBlur * 0.8;
    col = (col * 2.0
      + sampleGlass(p + vec2(b, b))
      + sampleGlass(p + vec2(-b, b))
      + sampleGlass(p + vec2(b, -b))
      + sampleGlass(p + vec2(-b, -b))) / 6.0;
  }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturate) * uBrightness;
  gl_FragColor = vec4(col, 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type)
	if (!shader) return null
	gl.shaderSource(shader, src)
	gl.compileShader(shader)
	return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
}

function sourceSize(source: LensSource): {w: number; h: number} {
	return source instanceof HTMLVideoElement
		? {w: source.videoWidth, h: source.videoHeight}
		: {w: source.naturalWidth, h: source.naturalHeight}
}

function sourceReady(source: LensSource): boolean {
	return source instanceof HTMLVideoElement
		? source.readyState >= 2 && !!source.videoWidth
		: source.complete && !!source.naturalWidth
}

function sourceUrl(source: LensSource): string {
	return source.currentSrc || source.src
}

/**
 * Drives `canvas` as a refraction lens over `getSource()` (the object-fit:
 * cover wallpaper <img>, or a <video>). Alignment is read from live bounding
 * rects each frame, so magnification/hover transforms stay in sync; frames
 * where nothing changed skip the draw, and image textures upload only when
 * the src changes. `onFirstFrame` fires after the first successful draw (use
 * it to reveal the canvas — an alpha:false context is opaque before then).
 * Returns a cleanup function, or null if WebGL is unavailable.
 *
 * `getParams` is read every frame (not captured at attach time) so lens
 * params can change live without tearing down and re-uploading the texture;
 * the param values feed the dirty-check state below, so a param change
 * repaints a static backdrop.
 */
export function attachBackdropLens(
	canvas: HTMLCanvasElement,
	getSource: () => LensSource | null,
	getParams: () => GlassLensParams,
	onFirstFrame?: () => void,
): (() => void) | null {
	const gl = canvas.getContext('webgl', {antialias: false, alpha: false})
	if (!gl) return null

	const vs = compile(gl, gl.VERTEX_SHADER, VERT)
	const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
	const program = gl.createProgram()
	if (!vs || !fs || !program) return null
	gl.attachShader(program, vs)
	gl.attachShader(program, fs)
	gl.linkProgram(program)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
	gl.useProgram(program)

	const quad = gl.createBuffer()
	gl.bindBuffer(gl.ARRAY_BUFFER, quad)
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
	const aPos = gl.getAttribLocation(program, 'aPos')
	gl.enableVertexAttribArray(aPos)
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

	const tex = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, tex)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

	const u = (name: string) => gl.getUniformLocation(program, name)
	const uSize = u('uSize')
	const uRadius = u('uRadius')
	const uBevel = u('uBevel')
	const uScale = u('uScale')
	const uChroma = u('uChroma')
	const uSaturate = u('uSaturate')
	const uBrightness = u('uBrightness')
	const uBlur = u('uBlur')
	const uUvOff = u('uUvOff')
	const uUvStep = u('uUvStep')

	// border-radius: inherit resolves through computed style; % clamps below.
	const radiusRaw = getComputedStyle(canvas).borderRadius

	let raf = 0
	let uploadedSrc: string | null = null
	let lastState = ''
	let drawn = false

	function frame() {
		raf = requestAnimationFrame(frame)
		const source = getSource()
		if (!source || !sourceReady(source)) return
		const cw = canvas.offsetWidth
		const ch = canvas.offsetHeight
		if (cw < 2 || ch < 2) return

		const isVideo = source instanceof HTMLVideoElement
		const params = getParams()
		const crect = canvas.getBoundingClientRect()
		const vrect = source.getBoundingClientRect()
		const state = [
			sourceUrl(source),
			cw,
			ch,
			crect.left,
			crect.top,
			crect.width,
			crect.height,
			vrect.left,
			vrect.top,
			vrect.width,
			vrect.height,
			// Live params feed the dirty-check so tuning a knob repaints a static backdrop
			params.scale,
			params.chroma,
			params.bevel,
			params.saturate,
			params.brightness,
			params.blur,
		].join()
		// Static backdrop and static geometry — nothing to redraw
		if (!isVideo && drawn && state === lastState) return
		lastState = state

		const dpr = Math.min(window.devicePixelRatio || 1, 2)
		const bw = Math.round(cw * dpr)
		const bh = Math.round(ch * dpr)
		if (canvas.width !== bw || canvas.height !== bh) {
			canvas.width = bw
			canvas.height = bh
		}
		gl!.viewport(0, 0, bw, bh)
		// Videos change every frame; images only when the src swaps
		const currentSourceUrl = sourceUrl(source)
		if (isVideo || uploadedSrc !== currentSourceUrl) {
			gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source)
			uploadedSrc = currentSourceUrl
		}

		// Map lens css px → texture UV, honoring object-fit: cover cropping.
		const {w: iw, h: ih} = sourceSize(source)
		const s = Math.max(vrect.width / iw, vrect.height / ih)
		const ox = vrect.left + (vrect.width - iw * s) / 2
		const oy = vrect.top + (vrect.height - ih * s) / 2

		const rv = parseFloat(radiusRaw) || 0
		const radius = Math.min(radiusRaw.includes('%') ? (Math.min(cw, ch) * rv) / 100 : rv, cw / 2, ch / 2)

		gl!.uniform2f(uSize, cw, ch)
		gl!.uniform1f(uRadius, radius)
		gl!.uniform1f(uBevel, resolveBevelPx(params.bevel, cw, ch))
		gl!.uniform1f(uScale, params.scale)
		gl!.uniform1f(uChroma, params.chroma)
		gl!.uniform1f(uSaturate, params.saturate)
		gl!.uniform1f(uBrightness, params.brightness)
		gl!.uniform1f(uBlur, params.blur)
		gl!.uniform2f(uUvOff, (crect.left - ox) / (s * iw), (crect.top - oy) / (s * ih))
		gl!.uniform2f(uUvStep, crect.width / cw / (s * iw), crect.height / ch / (s * ih))
		gl!.drawArrays(gl!.TRIANGLES, 0, 3)
		if (!drawn) {
			drawn = true
			onFirstFrame?.()
		}
	}

	function start() {
		if (!raf) raf = requestAnimationFrame(frame)
	}
	function stop() {
		if (raf) cancelAnimationFrame(raf)
		raf = 0
	}

	const io = new IntersectionObserver((entries) => {
		if (entries[0]?.isIntersecting) start()
		else stop()
	})
	io.observe(canvas)

	return () => {
		stop()
		io.disconnect()
		gl.deleteTexture(tex)
		gl.deleteBuffer(quad)
		gl.deleteProgram(program)
		gl.deleteShader(vs)
		gl.deleteShader(fs)
	}
}
