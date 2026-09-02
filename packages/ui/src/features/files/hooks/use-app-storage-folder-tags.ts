import {useMemo} from 'react'

import type {FileSystemItem} from '@/features/files/types'
import {getAppStorageSourcePaths} from '@/modules/apps/app-storage'
import {trpcReact, type RouterOutput, type UserApp} from '@/trpc/trpc'

// What a listing needs to draw an app beside a folder: its icon, and its name
// for the tooltip
export type FolderStorageApp = Pick<UserApp, 'id' | 'name' | 'icon'>

function normalizeStoragePath(path: string) {
	return path === '/' ? path : path.replace(/\/+$/, '')
}

type AppStorageFolderUsageApp = Pick<UserApp, 'id' | 'name' | 'icon' | 'storage'>

export function getAppStorageFolderUsage(apps: AppStorageFolderUsageApp[]) {
	const usedByPaths = new Map<string, FolderStorageApp[]>()

	for (const app of apps) {
		for (const sourcePath of getAppStorageSourcePaths(app, {includeDataRoot: false})) {
			const path = normalizeStoragePath(sourcePath)
			const folderApps = usedByPaths.get(path) ?? []
			if (!folderApps.some((folderApp) => folderApp.id === app.id)) {
				folderApps.push({id: app.id, name: app.name, icon: app.icon})
			}
			usedByPaths.set(path, folderApps)
		}
	}

	return {usedByPaths}
}

// The hook runs once per visible file row, but the usage map only depends on
// the shared apps.list payload, so it's derived once per payload here instead
// of once per row. WeakMap keyed on the cached array: a new payload computes a
// new map, and dropped payloads free their entry.
const usedByPathsCache = new WeakMap<object, Map<string, FolderStorageApp[]>>()

function getUsedByPaths(apps: RouterOutput['apps']['list']) {
	let usedByPaths = usedByPathsCache.get(apps)
	if (!usedByPaths) {
		const userApps = apps.filter((app): app is UserApp => !('error' in app))
		usedByPaths = getAppStorageFolderUsage(userApps).usedByPaths
		usedByPathsCache.set(apps, usedByPaths)
	}
	return usedByPaths
}

// Tags user folders that apps can access with the apps using them. The
// returned arrays are stable per apps.list payload, so consumers can memoize
// on them.
export function useAppStorageFolderTags() {
	// Queried directly instead of via useApps() so this works anywhere in the
	// tree, react-query dedupes it with the apps provider's query
	const appsQuery = trpcReact.apps.list.useQuery()
	const appsData = appsQuery.data

	return useMemo(() => {
		const usedByPaths = appsData ? getUsedByPaths(appsData) : new Map<string, FolderStorageApp[]>()

		const getFolderStorageApps = (item: Pick<FileSystemItem, 'path' | 'type'>): FolderStorageApp[] | null => {
			if (item.type !== 'directory') return null
			const folderApps = usedByPaths.get(normalizeStoragePath(item.path))
			return folderApps?.length ? folderApps : null
		}

		return {getFolderStorageApps}
	}, [appsData])
}
