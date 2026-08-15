const SAMPLE_RATE = 48_000
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2
const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE
const BUFFER_FRAMES = SAMPLE_RATE
const PREBUFFER_FRAMES = 4_800

export type MachineAudioSink = {
	enqueue: (data: ArrayBuffer) => void
	disconnect: () => void
}

function createScriptProcessorSink(context: AudioContext): MachineAudioSink {
	const left = new Float32Array(BUFFER_FRAMES)
	const right = new Float32Array(BUFFER_FRAMES)
	let read = 0
	let write = 0
	let frames = 0
	let playing = false
	let remainder = new Uint8Array(0)
	let disconnected = false

	// AudioWorklet is secure-context-only in Chromium. ScriptProcessor is
	// deprecated but remains the broadly supported Web Audio fallback for an
	// umbrelOS UI served over HTTP.
	const node = context.createScriptProcessor(2_048, 0, CHANNELS)
	node.onaudioprocess = (event) => {
		const outputLeft = event.outputBuffer.getChannelData(0)
		const outputRight = event.outputBuffer.getChannelData(1)
		if (!playing && frames >= PREBUFFER_FRAMES) playing = true

		for (let frame = 0; frame < outputLeft.length; frame++) {
			if (!playing || frames === 0) {
				outputLeft[frame] = 0
				outputRight[frame] = 0
				playing = false
				continue
			}
			outputLeft[frame] = left[read]
			outputRight[frame] = right[read]
			read = (read + 1) % BUFFER_FRAMES
			frames--
		}
	}
	node.connect(context.destination)

	return {
		enqueue(data) {
			if (disconnected) return
			const incoming = new Uint8Array(data)
			const bytes = new Uint8Array(remainder.length + incoming.length)
			bytes.set(remainder)
			bytes.set(incoming, remainder.length)
			const completeBytes = bytes.length - (bytes.length % FRAME_BYTES)
			remainder = bytes.slice(completeBytes)
			const pcm = new DataView(bytes.buffer, bytes.byteOffset, completeBytes)
			const incomingFrames = Math.floor(pcm.byteLength / FRAME_BYTES)
			const firstFrame = Math.max(0, incomingFrames - BUFFER_FRAMES)

			for (let frame = firstFrame; frame < incomingFrames; frame++) {
				if (frames === BUFFER_FRAMES) {
					read = (read + 1) % BUFFER_FRAMES
					frames--
				}
				left[write] = pcm.getInt16(frame * FRAME_BYTES, true) / 32_768
				right[write] = pcm.getInt16(frame * FRAME_BYTES + BYTES_PER_SAMPLE, true) / 32_768
				write = (write + 1) % BUFFER_FRAMES
				frames++
			}
		},
		disconnect() {
			disconnected = true
			node.onaudioprocess = null
			node.disconnect()
		},
	}
}

export async function createMachineAudioSink(context: AudioContext): Promise<MachineAudioSink> {
	// BaseAudioContext.audioWorklet is absent at runtime on HTTP origins even
	// though lib.dom declares it as required, so feature-detect it explicitly.
	const audioWorklet = (context as unknown as {audioWorklet?: AudioWorklet}).audioWorklet
	if (audioWorklet) {
		try {
			await audioWorklet.addModule('/machine-audio-worklet.js')
			const node = new AudioWorkletNode(context, 'machine-audio', {outputChannelCount: [CHANNELS]})
			node.connect(context.destination)
			return {
				enqueue: (data) => node.port.postMessage(data, [data]),
				disconnect: () => node.disconnect(),
			}
		} catch {
			// If the worklet cannot load, keep audio working through the HTTP-safe
			// path instead of treating the optional acceleration as required.
		}
	}
	return createScriptProcessorSink(context)
}
