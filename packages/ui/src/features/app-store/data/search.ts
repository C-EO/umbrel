// Local, instant app search. Searches only local registry fields — typing
// never triggers a network request.

import Fuse from 'fuse.js'

import {getCategoryLabel} from '@/features/app-store/data/catalog'
import type {RegistryApp} from '@/trpc/trpc'
import {fuseOptions} from '@/utils/search'

const searchKeys = [
	{name: 'name', weight: 3},
	{name: 'tagline', weight: 2},
	{name: 'description', weight: 1},
	{name: 'developer', weight: 1},
	// Lets "productivity" or a translated category name surface its apps
	{name: 'categoryLabel', weight: 1, getFn: (app: RegistryApp) => getCategoryLabel(app.category)},
]

export function createAppStoreSearch(apps: readonly RegistryApp[]) {
	const fuse = new Fuse<RegistryApp>(apps as RegistryApp[], {...fuseOptions, keys: searchKeys})

	return (pattern: string, limit = 60): RegistryApp[] => {
		const normalizedPattern = pattern.trim().replace(/\s+/g, ' ')
		if (!normalizedPattern) return []
		return fuse.search(normalizedPattern, {limit}).map((result) => result.item)
	}
}
