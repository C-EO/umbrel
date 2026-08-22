import {ExpandedContent} from '@/features/machines/components/floating-island/expanded'
import {MinimizedContent} from '@/features/machines/components/floating-island/minimized'
import type {Machine} from '@/features/machines/types'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'

// Install progress island: shown only while at least one machine is
// installing (visibility is gated by the container). One install gets the
// hero treatment — the machine's monitor waking up under a breathing glow —
// and several collapse into a list.
export function MachinesInstallIsland({machines}: {machines: Machine[]}) {
	return (
		<Island id='machines-install-island' nonDismissable defaultExpanded={false}>
			<IslandMinimized>
				<MinimizedContent machines={machines} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent machines={machines} />
			</IslandExpanded>
		</Island>
	)
}
