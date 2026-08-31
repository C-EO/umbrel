export function createReconnectResyncController({cooldownMs, onResync}: {cooldownMs: number; onResync: () => void}) {
	let socketOpen = false
	let resyncPending = false
	let lastResyncAt = Number.NEGATIVE_INFINITY
	let trailingTimer: ReturnType<typeof setTimeout> | undefined

	const clearTrailingTimer = () => {
		if (trailingTimer === undefined) return
		clearTimeout(trailingTimer)
		trailingTimer = undefined
	}

	const attemptResync = () => {
		if (!socketOpen || !resyncPending) return

		const remainingCooldown = cooldownMs - (Date.now() - lastResyncAt)
		if (remainingCooldown > 0) {
			if (trailingTimer !== undefined) return
			trailingTimer = setTimeout(() => {
				trailingTimer = undefined
				attemptResync()
			}, remainingCooldown)
			return
		}

		resyncPending = false
		lastResyncAt = Date.now()
		onResync()
	}

	return {
		onClose() {
			socketOpen = false
			resyncPending = true
			clearTrailingTimer()
		},
		onOpen() {
			socketOpen = true
			attemptResync()
		},
	}
}
