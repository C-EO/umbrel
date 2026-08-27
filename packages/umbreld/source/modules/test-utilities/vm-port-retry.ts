export const VM_PORT_COLLISION_RETRIES = 5

const QEMU_HOST_FORWARD_COLLISION_PATTERN = /Could not set up host forwarding rule ['"]tcp:127\.0\.0\.1:(\d+)-:\d+['"]/i

export function qemuHostForwardCollisionPort(error: unknown) {
	if (!(error instanceof Error)) return
	const match = error.message.match(QEMU_HOST_FORWARD_COLLISION_PATTERN)
	if (!match) return
	return Number(match[1])
}

export async function retryVmPortCollisions<T>({
	attempt,
	refreshPorts,
	isDynamicPort,
	onRetry,
	maxRetries = VM_PORT_COLLISION_RETRIES,
}: {
	attempt: () => Promise<T>
	refreshPorts: () => Promise<void>
	isDynamicPort: (port: number) => boolean
	onRetry?: (details: {port: number; retry: number; maxRetries: number}) => void
	maxRetries?: number
}) {
	for (let retry = 0; ; retry++) {
		try {
			return await attempt()
		} catch (error) {
			const port = qemuHostForwardCollisionPort(error)
			if (port === undefined || !isDynamicPort(port) || retry >= maxRetries) throw error

			await refreshPorts()
			onRetry?.({port, retry: retry + 1, maxRetries})
		}
	}
}
