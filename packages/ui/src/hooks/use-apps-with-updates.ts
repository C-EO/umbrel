import {canExecuteUpdate, isAppUpdateAvailable} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import type {RegistryApp} from '@/trpc/trpc'

const none: RegistryApp[] = []

/**
 * Installed apps whose registry version differs from the installed one,
 * derived from the cached apps list and registry (no requests of its own).
 * An app stays in the list while its update runs — the version only changes
 * once the update completes — so `updatingApps` singles those out for the
 * surfaces that must not fire a second update or must read "updating".
 */
export function useAppsWithUpdates() {
	const apps = useApps()
	const availableApps = useAllAvailableApps()

	// NOTE: a parent should have the apps loaded before we get here, but don't wanna assume
	if (apps.isLoading || availableApps.isLoading) {
		return {appsWithUpdates: none, updatingApps: none, updatableApps: none, isLoading: true} as const
	}

	const userApps = apps.userApps ?? []
	const appsWithUpdates = userApps
		.filter((app) => isAppUpdateAvailable(app.version, availableApps.appsKeyed[app.id]))
		.map((app) => availableApps.appsKeyed[app.id])

	// The list's state is authoritative here: the shared update mutation seeds
	// it optimistically, and server-side transitions (other tabs, agents)
	// arrive through the apps:state:change subscription
	const updatingApps = appsWithUpdates.filter((app) => apps.userAppsKeyed?.[app.id]?.state === 'updating')
	const updatableApps = appsWithUpdates.filter((app) =>
		canExecuteUpdate(apps.userAppsKeyed?.[app.id]?.state ?? 'not-installed', app.compatible),
	)

	return {appsWithUpdates, updatingApps, updatableApps, isLoading: false} as const
}
