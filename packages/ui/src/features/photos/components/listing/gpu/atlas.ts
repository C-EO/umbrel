// The texture the tiles are drawn from, and who is in it.
//
// One TEXTURE_2D_ARRAY of `plan.layers` layers of `side × side` texels, cut
// into square cells of whatever size the tiles currently need. An item's cell
// is `index mod slotCount`, and because the atlas is sized so that a bandful
// of items always fits (see capability.ts), two items on screen can never
// want the same cell. That single invariant is why there is no LRU here, no
// free list, no rectangle packer and no eviction policy to get wrong:
// `resident[slot] !== id` means "upload it", and nothing else is bookkeeping.
//
// Changing the cell size changes the slot count, so every cell moves. Rather
// than drop the pixels and fetch them all again — thousands of requests, for
// photographs already sitting on the GPU — the old array is drawn into the
// new one, one instanced pass per destination layer. Zooming out therefore
// never costs a fetch for anything already on screen, and the picture stays
// clean the whole way out instead of aliasing into sparkle.

import {cellAt, retierMap, slotCount, type AtlasPlan} from '@/features/photos/components/listing/gpu/capability'

const RETIER_VERTEX = `#version 300 es
in float aFrom;
in float aTo;
uniform float uSide;
uniform float uFromCell;
uniform float uToCell;
out vec3 vFrom;

vec2 cellOrigin(float slot, float cell, out float layer) {
	float perRow = floor(uSide / cell);
	float perLayer = perRow * perRow;
	layer = floor(slot / perLayer);
	float inLayer = slot - layer * perLayer;
	return vec2(mod(inLayer, perRow), floor(inLayer / perRow)) * cell;
}

void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
	float ignored;
	vec2 to = cellOrigin(aTo, uToCell, ignored) + corner * uToCell;
	gl_Position = vec4((to / uSide) * 2.0 - 1.0, 0.0, 1.0);
	float layer;
	vec2 from = cellOrigin(aFrom, uFromCell, layer);
	// Half a texel in from each edge, so bilinear can never reach a neighbour
	vFrom = vec3((from + 0.5 + corner * (uFromCell - 1.0)) / uSide, layer);
}`

const RETIER_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 vFrom;
uniform sampler2DArray uSource;
out vec4 outColor;
void main() { outColor = texture(uSource, vFrom); }`

export function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
	const build = (type: number, source: string) => {
		const shader = gl.createShader(type)!
		gl.shaderSource(shader, source)
		gl.compileShader(shader)
		return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
	}
	const vs = build(gl.VERTEX_SHADER, vertex)
	const fs = build(gl.FRAGMENT_SHADER, fragment)
	if (!vs || !fs) return null
	const program = gl.createProgram()!
	gl.attachShader(program, vs)
	gl.attachShader(program, fs)
	gl.linkProgram(program)
	gl.deleteShader(vs)
	gl.deleteShader(fs)
	return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null
}

export class Atlas {
	readonly plan: AtlasPlan
	cell: number
	slots: number
	texture: WebGLTexture
	// Which item is in each cell, by slot
	resident: (string | undefined)[]

	#gl: WebGL2RenderingContext
	#retier: {program: WebGLProgram; buffer: WebGLBuffer; vao: WebGLVertexArrayObject; frame: WebGLFramebuffer} | null =
		null

	constructor(gl: WebGL2RenderingContext, plan: AtlasPlan, cell: number) {
		this.#gl = gl
		this.plan = plan
		this.cell = cell
		this.slots = slotCount(plan, cell)
		this.resident = new Array<string | undefined>(this.slots)
		this.texture = this.#allocate()
	}

	#allocate() {
		const gl = this.#gl
		const texture = gl.createTexture()!
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
		gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, this.plan.side, this.plan.side, this.plan.layers)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		return texture
	}

	slotOf(index: number) {
		return index % this.slots
	}

	holds(index: number, id: string) {
		return this.resident[index % this.slots] === id
	}

	put(index: number, id: string, source: ImageBitmap) {
		if (source.width !== this.cell || source.height !== this.cell) return
		const gl = this.#gl
		const slot = index % this.slots
		const {layer, x, y} = cellAt(slot, this.plan.side, this.cell)
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
		gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, this.cell, this.cell, 1, gl.RGBA, gl.UNSIGNED_BYTE, source)
	}

	// Move to a new cell size, carrying every resident cell the band still
	// wants across in one pass. The second array lives only for the length of
	// this call.
	retier(cell: number, band: {start: number; end: number}, idAt: (index: number) => string | undefined) {
		if (cell === this.cell) return
		const gl = this.#gl
		const slots = slotCount(this.plan, cell)
		const moves = retierMap(this.resident, slots, band, idAt)
		const from = this.texture
		const fromCell = this.cell
		this.cell = cell
		this.slots = slots
		this.resident = new Array<string | undefined>(slots)
		this.texture = this.#allocate()
		if (moves.length > 0 && this.#blit(from, fromCell, moves)) {
			for (const move of moves) this.resident[move.to] = move.id
		}
		gl.deleteTexture(from)
	}

	#blit(from: WebGLTexture, fromCell: number, moves: {from: number; to: number}[]) {
		const gl = this.#gl
		const kit = (this.#retier ??= this.#buildRetier())
		if (!kit) return false
		const {side, layers} = this.plan
		const perLayer = Math.floor(side / this.cell) ** 2
		// One draw per destination layer, so each can be attached in turn
		const buckets: number[][] = Array.from({length: layers}, () => [])
		for (const move of moves) buckets[Math.floor(move.to / perLayer)]?.push(move.from, move.to)

		gl.bindFramebuffer(gl.FRAMEBUFFER, kit.frame)
		gl.useProgram(kit.program)
		gl.bindVertexArray(kit.vao)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, from)
		gl.uniform1i(gl.getUniformLocation(kit.program, 'uSource'), 0)
		gl.uniform1f(gl.getUniformLocation(kit.program, 'uSide'), side)
		gl.uniform1f(gl.getUniformLocation(kit.program, 'uFromCell'), fromCell)
		gl.uniform1f(gl.getUniformLocation(kit.program, 'uToCell'), this.cell)
		gl.disable(gl.BLEND)
		gl.viewport(0, 0, side, side)
		for (let layer = 0; layer < layers; layer++) {
			const bucket = buckets[layer]!
			if (bucket.length === 0) continue
			gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, 0, layer)
			gl.bindBuffer(gl.ARRAY_BUFFER, kit.buffer)
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bucket), gl.STREAM_DRAW)
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, bucket.length / 2)
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.bindVertexArray(null)
		gl.enable(gl.BLEND)
		return true
	}

	#buildRetier() {
		const gl = this.#gl
		const program = compile(gl, RETIER_VERTEX, RETIER_FRAGMENT)
		if (!program) return null
		const buffer = gl.createBuffer()!
		const vao = gl.createVertexArray()!
		gl.bindVertexArray(vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		for (const [name, offset] of [
			['aFrom', 0],
			['aTo', 4],
		] as const) {
			const location = gl.getAttribLocation(program, name)
			gl.enableVertexAttribArray(location)
			gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 8, offset)
			gl.vertexAttribDivisor(location, 1)
		}
		gl.bindVertexArray(null)
		return {program, buffer, vao, frame: gl.createFramebuffer()!}
	}

	dispose() {
		const gl = this.#gl
		gl.deleteTexture(this.texture)
		if (this.#retier) {
			gl.deleteProgram(this.#retier.program)
			gl.deleteBuffer(this.#retier.buffer)
			gl.deleteVertexArray(this.#retier.vao)
			gl.deleteFramebuffer(this.#retier.frame)
			this.#retier = null
		}
	}
}
