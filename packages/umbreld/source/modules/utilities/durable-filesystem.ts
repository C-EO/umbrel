import * as fs from 'node:fs/promises'
import nodePath from 'node:path'

import fse from 'fs-extra'

export async function syncDirectory(path: string) {
	const handle = await fs.open(path, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

// File contents are synced by the writer (for app moves, rsync --fsync). This
// flushes every directory entry created beneath the root before the root is
// made authoritative with an atomic rename.
export async function syncDirectoryTree(path: string) {
	for (const entry of await fs.readdir(path, {withFileTypes: true})) {
		if (entry.isDirectory()) await syncDirectoryTree(nodePath.join(path, entry.name))
	}
	await syncDirectory(path)
}

export async function renameDurably(source: string, destination: string) {
	await fs.rename(source, destination)
	const sourceParent = nodePath.dirname(source)
	const destinationParent = nodePath.dirname(destination)
	await syncDirectory(destinationParent)
	if (sourceParent !== destinationParent) await syncDirectory(sourceParent)
}

export async function removeDurably(path: string) {
	if (!(await fse.pathExists(path))) return
	await fse.remove(path)
	await syncDirectory(nodePath.dirname(path))
}

export async function writeFileDurably(path: string, temporaryPath: string, data: string, mode?: number) {
	try {
		const handle = await fs.open(temporaryPath, 'w', mode)
		try {
			await handle.writeFile(data, 'utf8')
			await handle.sync()
		} finally {
			await handle.close()
		}
		await renameDurably(temporaryPath, path)
	} catch (error) {
		await fse.remove(temporaryPath).catch(() => {})
		throw error
	}
}
