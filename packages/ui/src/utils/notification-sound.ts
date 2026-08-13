/**
 * The "arrival" notification sound, synthesized live with the Web Audio API —
 * a rising harmonic portal with a soft shimmer tail. No audio asset needed.
 *
 * Adapted from cuelume (https://github.com/Danilaa1/cuelume)
 * Copyright (c) 2026 Daniel Belyi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type BaseLayer = {
	/** Seconds after the trigger that this layer starts */
	offset?: number
	/** Fade-in time, in seconds */
	attack: number
	/** Fade-out time, in seconds, starting right after the attack */
	decay: number
	/** Peak volume reached at the end of the attack */
	peak: number
}

type ToneLayer = BaseLayer & {
	kind: 'tone'
	waveform: OscillatorType
	frequency: number
	glideTo?: number
	/** Defaults to attack + decay */
	glideTime?: number
}

type NoiseLayer = BaseLayer & {
	kind: 'noise'
	filterType: BiquadFilterType
	filterFrequency: number
	filterQ?: number
}

type SoundLayer = ToneLayer | NoiseLayer

type Shimmer = {
	delay: number
	feedback: number
	wet: number
	lowpass: number
}

type SoundRecipe = {
	masterGain: number
	layers: SoundLayer[]
	shimmer?: Shimmer
}

// An A3→A4 sine glide plus E5 and B5 harmonics over a lowpassed noise bed
const arrival: SoundRecipe = {
	masterGain: 0.44,
	layers: [
		{kind: 'noise', filterType: 'lowpass', filterFrequency: 900, filterQ: 0.8, attack: 0.05, decay: 0.24, peak: 0.035},
		{
			kind: 'tone',
			waveform: 'sine',
			frequency: 220,
			glideTo: 440,
			glideTime: 0.32,
			attack: 0.04,
			decay: 0.34,
			peak: 0.055,
		},
		{kind: 'tone', waveform: 'sine', frequency: 659.25, offset: 0.12, attack: 0.045, decay: 0.32, peak: 0.04},
		{kind: 'tone', waveform: 'sine', frequency: 987.77, offset: 0.19, attack: 0.045, decay: 0.34, peak: 0.032},
	],
	shimmer: {delay: 0.16, feedback: 0.28, wet: 0.18, lowpass: 3200},
}

const SOURCE_STOP_PADDING = 0.05
const CLEANUP_MARGIN = 0.05
const INAUDIBLE_GAIN = 0.001
// The recipe's per-layer peaks are calibrated against this makeup gain plus
// the limiter in the output chain — without them the sound is nearly inaudible
const OUTPUT_GAIN = 4

// A burst of notifications should chime once, not machine-gun
const THROTTLE_MS = 300
let lastPlayedAt = 0

function renderTone(context: AudioContext, destination: AudioNode, layer: ToneLayer, startTime: number): void {
	const oscillator = context.createOscillator()
	oscillator.type = layer.waveform
	oscillator.frequency.setValueAtTime(layer.frequency, startTime)

	if (layer.glideTo !== undefined) {
		const glideTime = layer.glideTime ?? layer.attack + layer.decay
		oscillator.frequency.exponentialRampToValueAtTime(layer.glideTo, startTime + glideTime)
	}

	// Exponential ramps can't reach zero, so envelopes bottom out at 0.0001
	const gain = context.createGain()
	gain.gain.setValueAtTime(0.0001, startTime)
	gain.gain.exponentialRampToValueAtTime(layer.peak, startTime + layer.attack)
	gain.gain.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay)

	oscillator.connect(gain).connect(destination)
	oscillator.start(startTime)
	oscillator.stop(startTime + layer.attack + layer.decay + SOURCE_STOP_PADDING)
}

function renderNoise(context: AudioContext, destination: AudioNode, layer: NoiseLayer, startTime: number): void {
	const duration = layer.attack + layer.decay + SOURCE_STOP_PADDING
	const length = Math.max(1, Math.floor(duration * context.sampleRate))
	const buffer = context.createBuffer(1, length, context.sampleRate)
	const data = buffer.getChannelData(0)
	for (let i = 0; i < length; i++) data[i] = 2 * Math.random() - 1

	const source = context.createBufferSource()
	source.buffer = buffer

	const filter = context.createBiquadFilter()
	filter.type = layer.filterType
	filter.frequency.value = layer.filterFrequency
	if (layer.filterQ !== undefined) filter.Q.value = layer.filterQ

	const gain = context.createGain()
	gain.gain.setValueAtTime(0.0001, startTime)
	gain.gain.exponentialRampToValueAtTime(layer.peak, startTime + layer.attack)
	gain.gain.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay)

	source.connect(filter).connect(gain).connect(destination)
	source.start(startTime)
	source.stop(startTime + duration)
}

/** Wires a soft echo/shimmer send off `source`, feeding back into `destination` */
function attachShimmer(
	context: AudioContext,
	source: AudioNode,
	destination: AudioNode,
	shimmer: Shimmer,
): AudioNode[] {
	const delay = context.createDelay(1)
	delay.delayTime.value = shimmer.delay

	const feedbackFilter = context.createBiquadFilter()
	feedbackFilter.type = 'lowpass'
	feedbackFilter.frequency.value = shimmer.lowpass

	const feedbackGain = context.createGain()
	feedbackGain.gain.value = shimmer.feedback

	const wetGain = context.createGain()
	wetGain.gain.value = shimmer.wet

	source.connect(delay)
	delay.connect(feedbackFilter)
	feedbackFilter.connect(feedbackGain)
	feedbackGain.connect(delay)
	feedbackFilter.connect(wetGain)
	wetGain.connect(destination)

	return [delay, feedbackFilter, feedbackGain, wetGain]
}

function sourceEnd(recipe: SoundRecipe): number {
	return Math.max(
		...recipe.layers.map((layer) => (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING),
	)
}

function shimmerTail(shimmer?: Shimmer): number {
	if (!shimmer || shimmer.feedback <= 0) return 0
	if (shimmer.feedback >= 1) return shimmer.delay
	return shimmer.delay * (1 + Math.ceil(Math.log(INAUDIBLE_GAIN) / Math.log(shimmer.feedback)))
}

let sharedOutput: GainNode | null = null

function getOutput(context: AudioContext): GainNode {
	if (sharedOutput) return sharedOutput

	const output = context.createGain()
	output.gain.value = OUTPUT_GAIN

	const limiter = context.createDynamicsCompressor()
	limiter.threshold.value = -8
	limiter.knee.value = 6
	limiter.ratio.value = 12
	limiter.attack.value = 0.002
	limiter.release.value = 0.08

	output.connect(limiter).connect(context.destination)
	sharedOutput = output
	return output
}

function renderRecipe(context: AudioContext, recipe: SoundRecipe): void {
	const now = context.currentTime
	const output = getOutput(context)
	const master = context.createGain()
	master.gain.value = recipe.masterGain
	master.connect(output)

	const shimmerNodes = recipe.shimmer ? attachShimmer(context, master, output, recipe.shimmer) : []

	for (const layer of recipe.layers) {
		const startTime = now + (layer.offset ?? 0)
		if (layer.kind === 'tone') renderTone(context, master, layer, startTime)
		else renderNoise(context, master, layer, startTime)
	}

	const cleanupAfterMs = (sourceEnd(recipe) + shimmerTail(recipe.shimmer) + CLEANUP_MARGIN) * 1000
	setTimeout(() => {
		master.disconnect()
		for (const node of shimmerNodes) node.disconnect()
	}, cleanupAfterMs)
}

let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
	if (sharedContext) return sharedContext
	if (typeof window === 'undefined') return null
	const Ctor =
		window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
	if (!Ctor) return null
	try {
		sharedContext = new Ctor()
	} catch {
		return null
	}
	return sharedContext
}

// Browsers only let audio start in (or after) a user gesture, and Safari
// refuses resume() outside a gesture call stack entirely. Resume the shared
// context on the first interaction so later notification sounds can play
// immediately.
if (typeof window !== 'undefined') {
	const prime = () => {
		const context = getAudioContext()
		if (context && context.state !== 'running') {
			try {
				void context.resume().catch(() => {})
			} catch {
				// Some browsers throw synchronously when audio is blocked
			}
		}
	}
	window.addEventListener('pointerdown', prime, {once: true})
	window.addEventListener('keydown', prime, {once: true})
}

export function playNotificationSound(): void {
	const now = Date.now()
	if (now - lastPlayedAt < THROTTLE_MS) return

	// Only chime when audio is already unlocked. Waiting on resume() here would
	// queue the sound and let the browser fire it at the user's next click
	// (e.g. while dismissing the toast), which reads as a bug. The gesture
	// listeners above unlock audio for every later toast.
	const context = getAudioContext()
	if (!context || context.state !== 'running') return

	lastPlayedAt = now
	renderRecipe(context, arrival)
}
