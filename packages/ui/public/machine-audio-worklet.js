class MachineAudioProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.capacity = 48_000
		this.prebuffer = 4_800
		this.left = new Float32Array(this.capacity)
		this.right = new Float32Array(this.capacity)
		this.read = 0
		this.write = 0
		this.frames = 0
		this.playing = false
		this.remainder = new Uint8Array(0)
		this.port.onmessage = ({data}) => this.enqueue(data)
	}

	enqueue(data) {
		if (!(data instanceof ArrayBuffer)) return
		const incoming = new Uint8Array(data)
		const bytes = new Uint8Array(this.remainder.length + incoming.length)
		bytes.set(this.remainder)
		bytes.set(incoming, this.remainder.length)
		const completeBytes = bytes.length - (bytes.length % 4)
		this.remainder = bytes.slice(completeBytes)
		const pcm = new DataView(bytes.buffer, bytes.byteOffset, completeBytes)
		const incomingFrames = Math.floor(pcm.byteLength / 4)
		const firstFrame = Math.max(0, incomingFrames - this.capacity)

		for (let frame = firstFrame; frame < incomingFrames; frame++) {
			if (this.frames === this.capacity) {
				this.read = (this.read + 1) % this.capacity
				this.frames--
			}
			this.left[this.write] = pcm.getInt16(frame * 4, true) / 32_768
			this.right[this.write] = pcm.getInt16(frame * 4 + 2, true) / 32_768
			this.write = (this.write + 1) % this.capacity
			this.frames++
		}
	}

	process(_inputs, outputs) {
		const output = outputs[0]
		if (!output?.length) return true
		if (!this.playing && this.frames >= this.prebuffer) this.playing = true

		for (let frame = 0; frame < output[0].length; frame++) {
			if (!this.playing || this.frames === 0) {
				output[0][frame] = 0
				if (output[1]) output[1][frame] = 0
				this.playing = false
				continue
			}
			output[0][frame] = this.left[this.read]
			if (output[1]) output[1][frame] = this.right[this.read]
			this.read = (this.read + 1) % this.capacity
			this.frames--
		}
		return true
	}
}

registerProcessor('machine-audio', MachineAudioProcessor)
