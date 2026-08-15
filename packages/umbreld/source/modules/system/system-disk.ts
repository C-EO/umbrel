import fse from 'fs-extra'
import {$} from 'execa'

type BlockDeviceRelation = {
	name: string
	pkname?: string | null
	type: string
}

// Map filesystem sources (from df) to the kernel names of every physical disk that backs them.
// Device-mapper and other stacked block devices are resolved recursively through pkname.
// Non-/dev sources (zfs datasets, overlays) are skipped, but every /dev source must resolve.
export function resolveSystemDiskNames(
	sources: Array<string | undefined>,
	blockDevices: BlockDeviceRelation[],
): Set<string> {
	const relationsByName = new Map<string, BlockDeviceRelation[]>()
	for (const device of blockDevices) {
		const relations = relationsByName.get(device.name) ?? []
		relations.push(device)
		relationsByName.set(device.name, relations)
	}

	const resolvePhysicalDisks = (deviceName: string, resolving = new Set<string>()): Set<string> => {
		if (resolving.has(deviceName)) throw new Error(`Block device ancestry contains a cycle at /dev/${deviceName}`)

		const relations = relationsByName.get(deviceName)
		if (!relations?.length) throw new Error(`Could not resolve system block device /dev/${deviceName}`)

		const parentNames = [...new Set(relations.map((device) => device.pkname).filter((name): name is string => !!name))]
		if (parentNames.length === 0) {
			if (relations.some((device) => device.type === 'disk')) return new Set([deviceName])
			throw new Error(`System block device /dev/${deviceName} does not resolve to a physical disk`)
		}

		const nextResolving = new Set(resolving).add(deviceName)
		const physicalDisks = new Set<string>()
		for (const parentName of parentNames) {
			for (const physicalDisk of resolvePhysicalDisks(parentName, nextResolving)) physicalDisks.add(physicalDisk)
		}
		return physicalDisks
	}

	const systemDisks = new Set<string>()
	for (const source of sources) {
		if (!source?.startsWith('/dev/')) continue
		const deviceName = source.slice('/dev/'.length)
		for (const physicalDisk of resolvePhysicalDisks(deviceName)) systemDisks.add(physicalDisk)
	}

	if (systemDisks.size === 0) throw new Error('Could not determine the physical disk backing the running system')
	return systemDisks
}

// Resolve the physical disks backing the running system. Rugix's config partition
// provides the authoritative boot-disk source when / is an overlay and data lives on
// ZFS. Callers that also run outside Rugix may opt into best-effort behavior there,
// but resolution always fails closed when the Rugix runtime is present.
export async function getSystemDiskNames(
	dataDirectory: string,
	{allowUnresolvedOutsideRugix = false}: {allowUnresolvedOutsideRugix?: boolean} = {},
): Promise<Set<string>> {
	const rugixRuntimePath = '/run/rugix'
	const rugixConfigPath = '/run/rugix/mounts/config'
	const isRugixSystem = await fse.pathExists(rugixRuntimePath)
	const systemPaths = [
		{path: '/', optional: false},
		{path: rugixConfigPath, optional: true},
		{path: dataDirectory, optional: false},
	]

	try {
		const sources = await Promise.all(
			systemPaths.map(async ({path: systemPath, optional}) => {
				if (!(await fse.pathExists(systemPath))) {
					if (optional) return undefined
					throw new Error(`System path does not exist: ${systemPath}`)
				}

				const {stdout} = await $`df ${systemPath} --output=source`
				const source = stdout
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
					.pop()
				if (!source) throw new Error(`Could not determine the filesystem source for ${systemPath}`)
				if (!source.startsWith('/dev/')) return source

				// df may report a stable symlink such as /dev/mapper/root. Resolve it to the
				// kernel name used by lsblk before walking its physical-disk ancestry.
				return fse.realpath(source.replace(/\[.*\]$/, ''))
			}),
		)

		const {stdout} = await $`lsblk --output KNAME,TYPE --json --tree`
		const parsed = JSON.parse(stdout) as {
			blockdevices?: Array<{kname?: string; type?: string; children?: unknown[]}>
		}
		if (!Array.isArray(parsed.blockdevices)) throw new Error('lsblk did not return a block device list')

		type LsblkNode = {kname?: string; type?: string; children?: LsblkNode[]}
		const flattenBlockDevices = (nodes: LsblkNode[], parentName?: string): BlockDeviceRelation[] =>
			nodes.flatMap((device) => {
				if (!device.kname || !device.type) throw new Error('lsblk returned an incomplete block device entry')
				return [
					{name: device.kname, pkname: parentName, type: device.type},
					...flattenBlockDevices(device.children ?? [], device.kname),
				]
			})
		const blockDevices = flattenBlockDevices(parsed.blockdevices as LsblkNode[])
		return resolveSystemDiskNames(sources, blockDevices)
	} catch (error) {
		if (allowUnresolvedOutsideRugix && !isRugixSystem) return new Set()
		throw error
	}
}
