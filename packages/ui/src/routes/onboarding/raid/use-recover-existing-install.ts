import {useEffect, useState} from 'react'

import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {trpcClient, trpcReact} from '@/trpc/trpc'

// Shared recovery logic for the Pro and HDD onboarding flows: run the recovery mutation,
// then poll system status to detect when the recovery reboot has completed.
export function useRecoverExistingInstall() {
	const {suppressErrors} = useGlobalSystemState()
	const [restoreRequested, setRestoreRequested] = useState(false)
	const [restoreFailed, setRestoreFailed] = useState(false)

	const recoverMut = trpcReact.hardware.raid.recoverExistingInstall.useMutation()

	// Poll system status with the vanilla client to detect when the recovery reboot has completed.
	// The backend sets status to 'restarting' before the mutation resolves, so polls from here on
	// return 'restarting' until the device goes down, then fail while it reboots - a fresh 'running'
	// can only mean the reboot finished. We deliberately avoid the shared react-query cache here: it
	// already holds a stale pre-reboot 'running' from the global system state provider's background
	// polling, which would trigger the redirect before the reboot even starts.
	const rebootStarted = recoverMut.data === true
	useEffect(() => {
		if (!rebootStarted) return
		const interval = setInterval(async () => {
			try {
				const status = await trpcClient.system.status.query()
				// Land on `/` and let the router guards route the outcome: login on a successful
				// recovery, or the RAID error screen if the pool failed to mount.
				if (status === 'running') window.location.href = '/'
			} catch {
				// Expected while the device is down mid-reboot - keep polling
			}
		}, 2000)
		return () => clearInterval(interval)
	}, [rebootStarted])

	const handleRestore = async () => {
		suppressErrors()
		setRestoreRequested(true)
		setRestoreFailed(false)
		recoverMut.reset()

		try {
			const recovered = await recoverMut.mutateAsync()
			if (!recovered) setRestoreFailed(true)
		} catch {
			setRestoreFailed(true)
		}
	}

	return {
		handleRestore,
		restoreRequested,
		restoreFailed,
		errorMessage: recoverMut.error?.message,
	}
}
