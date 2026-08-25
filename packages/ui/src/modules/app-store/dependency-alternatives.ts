import {UMBREL_APP_STORE_ID} from '@/constants/app-store'
import type {RegistryApp, UserApp} from '@/trpc/trpc'

export type DependencyAlternatives = {dependencyId: string; appIds: string[]}

const noUnavailableAppIds = new Set<string>()

/**
 * Apps that can satisfy a dependency by declaring it in `implements`.
 * Community apps only count when installed, and an installed app's
 * `implements` wins over its registry entry so alternatives from removed
 * community stores still resolve.
 */
export function getAppsImplementingDependency(
	apps: readonly RegistryApp[],
	userAppsKeyed: Record<string, UserApp> | undefined,
	dependencyId: string,
	unavailableAppIds: ReadonlySet<string> = noUnavailableAppIds,
): string[] {
	const registryIds = new Set(apps.map((app) => app.id))
	const installedWithoutRegistry = Object.values(userAppsKeyed ?? {}).filter(
		(app) => !registryIds.has(app.id) && !unavailableAppIds.has(app.id),
	)
	const eligibleRegistryApps = apps
		.filter(
			(app) => !unavailableAppIds.has(app.id) && (app.appStoreId === UMBREL_APP_STORE_ID || userAppsKeyed?.[app.id]),
		)
		.map((app) => userAppsKeyed?.[app.id] ?? app)

	return [...eligibleRegistryApps, ...installedWithoutRegistry]
		.filter((app) => app.implements?.includes(dependencyId))
		.map((app) => app.id)
}

/**
 * The resolvable alternatives for each declared dependency, grouped per
 * dependency. The canonical app comes first when its metadata is available:
 *
 * ```
 * [
 *   {dependencyId, appIds: [dependencyId, implementingId]},
 *   {dependencyId, appIds: []}, // metadata unavailable for every candidate
 * ]
 * ```
 */
export function getDependencyAlternatives(
	dependencies: string[] | undefined,
	apps: readonly RegistryApp[],
	userAppsKeyed: Record<string, UserApp> | undefined,
	unavailableAppIds: ReadonlySet<string> = noUnavailableAppIds,
): DependencyAlternatives[] {
	const resolvableIds = new Set(
		[...apps.map((app) => app.id), ...Object.keys(userAppsKeyed ?? {})].filter(
			(appId) => !unavailableAppIds.has(appId),
		),
	)
	return (dependencies ?? []).map((dependencyId) => ({
		dependencyId,
		appIds: [
			...new Set([
				dependencyId,
				...getAppsImplementingDependency(apps, userAppsKeyed, dependencyId, unavailableAppIds),
			]),
		].filter((appId) => resolvableIds.has(appId)),
	}))
}
