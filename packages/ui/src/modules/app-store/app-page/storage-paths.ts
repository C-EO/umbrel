import {EXTERNAL_STORAGE_PATH, HOME_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import type {UserApp} from '@/trpc/trpc'

export function isFolderAccessSourceSelectable({path}: {path: string}) {
	if (path === HOME_PATH || path.startsWith(`${HOME_PATH}/`)) return true
	const segments = path.split('/').filter(Boolean)
	if (path.startsWith(`${EXTERNAL_STORAGE_PATH}/`)) return segments.length >= 2
	// /Network/<host> groups shares; /Network/<host>/<share> is the first
	// directory that can actually be mounted.
	if (path.startsWith(`${NETWORK_STORAGE_PATH}/`)) return segments.length >= 3
	return false
}

export function isStorageBrowserPath(path: string) {
	return (
		path === HOME_PATH ||
		path.startsWith(`${HOME_PATH}/`) ||
		path.startsWith(`${EXTERNAL_STORAGE_PATH}/`) ||
		path.startsWith(`${NETWORK_STORAGE_PATH}/`)
	)
}

export function getStorageBrowserOpenPath(path?: string, fallback: string = HOME_PATH) {
	return path && isStorageBrowserPath(path) ? path : fallback
}

export function getManagedDataRootPath(app: UserApp) {
	return app.storage?.dataRoot?.location ?? null
}

export function storagePathsOverlap(a: string, b: string) {
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}
