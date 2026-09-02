import type {UserApp} from '@/trpc/trpc'

type AppFolderAccessSlot = NonNullable<UserApp['storage']>['folderAccess'][number]

// An app-suggested folder the user hasn't pointed elsewhere still resolves to
// the app's default source, so every surface asking where a folder-access slot
// points must apply the same fallback.
export function getFolderAccessSourcePath(folder: Pick<AppFolderAccessSlot, 'sourcePath' | 'defaultSourcePath'>) {
	return folder.sourcePath ?? folder.defaultSourcePath ?? null
}

// Every folder on the user's storage this app reaches into: its relocated data
// root, the folder-access sources it was granted, and its custom mounts.
// Deduplicated, in that order. Pass {includeDataRoot: false} for surfaces that
// only care about shared user folders, not the app's own data.
export function getAppStorageSourcePaths(
	app: Pick<UserApp, 'storage'>,
	{includeDataRoot = true}: {includeDataRoot?: boolean} = {},
): string[] {
	const sourcePaths = new Set<string>()

	const dataRootLocation = app.storage?.dataRoot?.location
	if (includeDataRoot && dataRootLocation) sourcePaths.add(dataRootLocation)
	for (const folder of app.storage?.folderAccess ?? []) {
		const sourcePath = getFolderAccessSourcePath(folder)
		if (sourcePath) sourcePaths.add(sourcePath)
	}
	for (const mount of app.storage?.customMounts ?? []) sourcePaths.add(mount.sourcePath)

	return [...sourcePaths]
}
