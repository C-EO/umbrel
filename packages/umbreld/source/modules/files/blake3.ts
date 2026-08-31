import {readFile} from 'node:fs/promises'

type Blake3Input = string | Uint8Array

export interface Blake3HasherInstance {
	update(input: Blake3Input): this
	digestBuffer(): Buffer
}

export type Blake3HasherConstructor = new () => Blake3HasherInstance

type WasmHasher = {
	update(input: Uint8Array): void
	finalize(): Uint8Array
}

type WasmHasherConstructor = new () => WasmHasher

type Blake3LoaderOptions = {
	readCpuInfo?: () => Promise<string>
	loadNative?: () => Promise<{Blake3Hasher: Blake3HasherConstructor}>
	loadWasm?: () => Promise<{Hasher: WasmHasherConstructor}>
}

export function isRaspberryPiCpuInfo(cpuInfo: string) {
	return cpuInfo.includes('Raspberry Pi ')
}

async function readCpuInfo() {
	try {
		return await readFile('/proc/cpuinfo', 'utf8')
	} catch {
		return ''
	}
}

function createWasmBlake3Hasher(Hasher: WasmHasherConstructor): Blake3HasherConstructor {
	return class WasmBlake3Hasher implements Blake3HasherInstance {
		#hasher = new Hasher()

		update(input: Blake3Input) {
			this.#hasher.update(typeof input === 'string' ? Buffer.from(input) : input)
			return this
		}

		digestBuffer() {
			return Buffer.from(this.#hasher.finalize())
		}
	}
}

// The native ARM64 binding initializes mimalloc with ARMv8.1 LSE instructions,
// which crash on Raspberry Pi 4 before JavaScript can catch the failed import.
// Detect Pi hardware first so every other platform keeps the existing native path.
export async function loadBlake3Hasher({
	readCpuInfo: getCpuInfo = readCpuInfo,
	loadNative = () => import('@napi-rs/blake-hash'),
	loadWasm = () => import('blake3-wasm-rs'),
}: Blake3LoaderOptions = {}): Promise<Blake3HasherConstructor> {
	if (!isRaspberryPiCpuInfo(await getCpuInfo())) return (await loadNative()).Blake3Hasher

	const {Hasher} = await loadWasm()
	return createWasmBlake3Hasher(Hasher)
}

export const Blake3Hasher = await loadBlake3Hasher()
