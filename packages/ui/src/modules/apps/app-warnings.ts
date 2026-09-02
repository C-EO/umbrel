import {UserApp} from '@/trpc/trpc'

export type AppWarning = 'app-storage' | 'app-data-missing' | 'folder-access'

// A single source of truth for why an app needs attention. Keep the reason, not
// just a boolean, so every surface sends the user to the right explanation.
export function getAppWarning(app: UserApp): AppWarning | null {
	if (app.storage?.dataRoot?.status === 'storage-unavailable') return 'app-storage'
	if (app.storage?.dataRoot?.status === 'data-missing') return 'app-data-missing'
	if ((app.storage?.missingSourcePaths.length ?? 0) > 0) return 'folder-access'
	return null
}
