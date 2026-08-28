import PQueue from 'p-queue'

type UploadDiskPreflightOptions = {
	getAvailableBytes: () => Promise<number>
	reserveBytes: number
}

// Serializes admission and debits each upload exactly once from a stable
// free-space snapshot. Refreshing that snapshot while uploads are writing would
// double-count their on-disk bytes; file size is not a safe correction because
// delayed-allocation filesystems can expose a new size before free-space
// reporting catches up.
export default class UploadDiskPreflight {
	#activeUploads = new Map<string, number>()
	#admissionQueue = new PQueue({concurrency: 1})
	#getAvailableBytes: UploadDiskPreflightOptions['getAvailableBytes']
	#remainingBatchBytes: number | undefined
	#reserveBytes: number

	constructor({getAvailableBytes, reserveBytes}: UploadDiskPreflightOptions) {
		this.#getAvailableBytes = getAvailableBytes
		this.#reserveBytes = reserveBytes
	}

	async admit(uploadId: string, contentLength: number) {
		return await this.#admissionQueue.add(async () => {
			if (this.#remainingBatchBytes === undefined) {
				this.#remainingBatchBytes = (await this.#getAvailableBytes()) - this.#reserveBytes
			}
			if (contentLength > this.#remainingBatchBytes) {
				// With no active batch there is nothing to keep this snapshot
				// consistent with, so let a later user retry observe fresh space.
				if (this.#activeUploads.size === 0) this.#remainingBatchBytes = undefined
				return false
			}

			this.#activeUploads.set(uploadId, contentLength)
			this.#remainingBatchBytes -= contentLength
			return true
		})
	}

	async release(uploadId: string, {restoreCapacity}: {restoreCapacity: boolean}) {
		await this.#admissionQueue.add(() => {
			const contentLength = this.#activeUploads.get(uploadId)
			if (contentLength === undefined) return

			this.#activeUploads.delete(uploadId)
			if (restoreCapacity && this.#remainingBatchBytes !== undefined) this.#remainingBatchBytes += contentLength
			if (this.#activeUploads.size === 0) this.#remainingBatchBytes = undefined
		})
	}
}
