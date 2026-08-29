import {useEffect} from 'react'

import {usePoolDeviceType} from '@/features/storage/hooks/use-pool-device-type'
import {useRaidProgress, type RaidOperationType, type RaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

// Re-export types for use in child components
export type {RaidOperationType, RaidProgress}

// Scrubs run silently in the background - their results surface through toasts and the
// storage manager, never an island - so island contents only deal with the remaining
// operation types. useRaidProgress still tracks scrub for the toasts and dialog gating.
export type IslandOperationType = Exclude<RaidOperationType, 'scrub'>
export type IslandRaidProgress = Omit<RaidProgress, 'type'> & {type: IslandOperationType}

export function isIslandOperation(operation: RaidProgress): operation is IslandRaidProgress {
	return operation.type !== 'scrub'
}

// i18n translation keys for operation types - call t() with these at render time
// t('storage-manager.operation.expanding')
// t('storage-manager.operation.rebuilding')
// t('storage-manager.operation.replacing')
// t('storage-manager.operation.enabling-failsafe')
export const raidOperationLabels: Record<IslandOperationType, string> = {
	expansion: 'storage-manager.operation.expanding',
	rebuild: 'storage-manager.operation.rebuilding',
	replace: 'storage-manager.operation.replacing',
	'failsafe-transition': 'storage-manager.operation.enabling-failsafe',
}

export function RaidIsland() {
	const realOperation = useRaidProgress()
	const {pendingOperation, clearPendingOperation} = usePendingRaidOperation()
	// HDD pools get platter visuals, SSD pools the NAND flicker (and 'ssd' is the fallback while loading)
	const deviceType = usePoolDeviceType()

	// A scrub is never displayed, so it must not clear a pending operation either
	const displayedRealOperation = realOperation && isIslandOperation(realOperation) ? realOperation : null

	// When real events arrive, clear the pending operation
	useEffect(() => {
		if (displayedRealOperation && pendingOperation) {
			clearPendingOperation()
		}
	}, [displayedRealOperation, pendingOperation, clearPendingOperation])

	// Use real operation if available, otherwise fall back to pending
	const activeOperation = displayedRealOperation ?? pendingOperation

	// Don't render without a displayable operation (dialogs never set a pending scrub).
	// Container handles visibility check, but this is a safety fallback.
	if (!activeOperation || !isIslandOperation(activeOperation)) return null

	// Force the island to stay expanded when rebooting so the countdown is always visible.
	// This helps ensure users see this critical warning before the system restarts.
	const isRebooting = activeOperation.state === 'rebooting'

	return (
		<Island id='raid-island' nonDismissable forceExpanded={isRebooting}>
			<IslandMinimized>
				<MinimizedContent operation={activeOperation} deviceType={deviceType} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent operation={activeOperation} deviceType={deviceType} />
			</IslandExpanded>
		</Island>
	)
}
