// Pure catalog selectors for the App Store.
//
// "Local truth, remote taste": the locally synced registry decides which apps
// exist and what state they're in. Remote metadata (creation/update dates from
// apps.umbrel.com) may only decorate or order apps that already exist locally,
// which is why every selector here takes local registry data as its base.

import {arrayIncludes} from 'ts-extras'

import {categories, categoryLabels, categoryNavOrder} from '@/features/app-store/constants'
import type {AppState, RegistryApp, UserApp} from '@/trpc/trpc'

// ---------------------------------------------------------------------------
// App status
// ---------------------------------------------------------------------------

export type AppStoreStatus = 'available' | 'installed' | 'update-available' | 'in-progress' | 'incompatible'
export type AppStoreAction = 'install' | 'open' | 'update'

// States that represent an action in flight (mirrors pollStates in
// use-app-install.ts, duplicated here to keep this module dependency-free)
const inProgressStates = ['installing', 'uninstalling', 'updating', 'starting', 'restarting', 'stopping'] as const

export function deriveAppStatus({
	compatible,
	installedState,
	updateAvailable,
}: {
	compatible: boolean
	/** State of the installed app, or undefined when not installed */
	installedState?: AppState
	updateAvailable: boolean
}): AppStoreStatus {
	if (installedState === undefined) return compatible ? 'available' : 'incompatible'
	if (arrayIncludes(inProgressStates, installedState)) return 'in-progress'
	if (updateAvailable) return 'update-available'
	return 'installed'
}

export function buildAppStatusMap(
	apps: readonly RegistryApp[],
	userAppsKeyed: Record<string, UserApp> | undefined,
): Map<string, AppStoreStatus> {
	const statuses = new Map<string, AppStoreStatus>()
	for (const app of apps) {
		const userApp = userAppsKeyed?.[app.id]
		statuses.set(
			app.id,
			deriveAppStatus({
				compatible: app.compatible,
				installedState: userApp?.state,
				updateAvailable: Boolean(userApp && app.version !== userApp.version),
			}),
		)
	}
	return statuses
}

/** The only valid card action for a settled catalog/live-state combination. */
export function getAppStoreAction(status: AppStoreStatus, transitioning: boolean): AppStoreAction | undefined {
	if (transitioning || status === 'in-progress') return undefined

	switch (status) {
		case 'available':
		case 'incompatible':
			return 'install'
		case 'installed':
			return 'open'
		case 'update-available':
			return 'update'
	}
}

// ---------------------------------------------------------------------------
// Remote date metadata
// ---------------------------------------------------------------------------

export type AppDates = {
	/** Epoch ms. Applied unconditionally — creation date is not version-sensitive. */
	createdAt?: number
	/** Epoch ms. Applied only when the remote version matches the local version. */
	updatedAt?: number
}

/**
 * Builds a per-app date map from remote metadata, reconciled against the
 * local registry: `createdAt` is always applied, `updatedAt` only when the
 * remote entry describes the exact version the local registry offers, so a
 * remote feed that is ahead of the device can never claim a newer update date
 * than what is actually installable.
 */
export function buildAppDates(
	remoteApps: readonly {id: string; version: string; createdAt?: string | null; updatedAt?: string | null}[],
	localAppsKeyed: Record<string, Pick<RegistryApp, 'version'>>,
): Map<string, AppDates> {
	const dates = new Map<string, AppDates>()
	for (const remoteApp of remoteApps) {
		const localApp = localAppsKeyed[remoteApp.id]
		if (!localApp) continue

		const entry: AppDates = {}
		const createdAt = parseDate(remoteApp.createdAt)
		if (createdAt !== undefined) entry.createdAt = createdAt

		if (remoteApp.version === localApp.version) {
			const updatedAt = parseDate(remoteApp.updatedAt)
			if (updatedAt !== undefined) entry.updatedAt = updatedAt
		}

		if (entry.createdAt !== undefined || entry.updatedAt !== undefined) dates.set(remoteApp.id, entry)
	}
	return dates
}

function parseDate(value: string | null | undefined): number | undefined {
	if (!value) return undefined
	const parsed = Date.parse(value)
	return Number.isNaN(parsed) ? undefined : parsed
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type AppSortId = 'name' | 'newest' | 'recently-updated'

/**
 * Date-based sorts are only offered when remote metadata actually provides
 * usable dates; offline the store simply shows the always-available options
 * instead of disabled controls.
 */
export function getAvailableSorts(dates: Map<string, AppDates> | undefined): AppSortId[] {
	const sorts: AppSortId[] = ['name']
	if (!dates || dates.size === 0) return sorts

	let hasCreatedAt = false
	let hasUpdatedAt = false
	for (const entry of dates.values()) {
		hasCreatedAt ||= entry.createdAt !== undefined
		hasUpdatedAt ||= entry.updatedAt !== undefined
		if (hasCreatedAt && hasUpdatedAt) break
	}

	if (hasCreatedAt) sorts.push('newest')
	if (hasUpdatedAt) sorts.push('recently-updated')
	return sorts
}

export function createNameCollator(locale?: string) {
	// Stable, human-friendly ordering: case-insensitive, numeric-aware
	return new Intl.Collator(locale, {sensitivity: 'base', numeric: true})
}

export function sortApps(
	apps: readonly RegistryApp[],
	sort: AppSortId,
	dates: Map<string, AppDates> | undefined,
	collator: Intl.Collator = createNameCollator(),
): RegistryApp[] {
	const byName = (a: RegistryApp, b: RegistryApp) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)

	if (sort === 'name' || !dates) return [...apps].sort(byName)

	const key = sort === 'newest' ? 'createdAt' : 'updatedAt'
	return [...apps].sort((a, b) => {
		const aDate = dates.get(a.id)?.[key]
		const bDate = dates.get(b.id)?.[key]
		// Apps without dates sort after dated apps, alphabetically
		if (aDate === undefined && bDate === undefined) return byName(a, b)
		if (aDate === undefined) return 1
		if (bDate === undefined) return -1
		return bDate - aDate || byName(a, b)
	})
}

// ---------------------------------------------------------------------------
// Related apps
// ---------------------------------------------------------------------------

// Small deterministic string hash so "you might also like" is stable per app
// across visits instead of reshuffling on every mount
function stableRank(seed: string, appId: string): number {
	const value = `${seed}:${appId}`
	let hash = 0
	for (let index = 0; index < value.length; index++) {
		hash = (hash * 31 + value.charCodeAt(index)) | 0
	}
	return hash >>> 0
}

export function getRelatedApps(apps: readonly RegistryApp[], appId: string, count = 5): RegistryApp[] {
	const app = apps.find((candidate) => candidate.id === appId)
	if (!app) return []

	return apps
		.filter((candidate) => candidate.category === app.category && candidate.id !== appId)
		.sort((a, b) => stableRank(appId, a.id) - stableRank(appId, b.id) || a.id.localeCompare(b.id))
		.slice(0, count)
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function getCategoryLabel(categoryId: string): string {
	const label = categoryLabels[categoryId as keyof typeof categoryLabels]
	if (label) return label()

	// Unknown manifest categories are title-cased for display
	return categoryId
		.split(/[-_]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}

/**
 * The navigation rail: Discover and All apps, then the predefined categories
 * (in their canonical order) that actually have apps, then any dynamic
 * categories coming from app manifests umbrelOS doesn't know about yet.
 */
export function getNavCategories(appsGroupedByCategory: Record<string, readonly unknown[]>): string[] {
	const hasApps = (categoryId: string) => (appsGroupedByCategory[categoryId]?.length ?? 0) > 0
	const dynamicCategories = Object.keys(appsGroupedByCategory)
		.filter((categoryId) => !arrayIncludes(categories, categoryId))
		.sort()

	return ['discover', 'all', ...categoryNavOrder.filter(hasApps), ...dynamicCategories.filter(hasApps)]
}
