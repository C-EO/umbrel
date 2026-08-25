import {useAppsWithUpdates} from './use-apps-with-updates'
import {useUpdateAppMutation} from './use-update-app'

/**
 * Update every app that can be updated right now. Both flags are derived from
 * the apps' states rather than this hook's own mutation, so they hold for
 * updates started from a card, the app page, another tab or an agent too:
 * Update all stays available while anything is still left to start (and never
 * re-fires an update that is already running), and reads as "updating" only
 * once every update it could start is in flight.
 */
export function useUpdateAllApps() {
	const {updatableApps, updatingApps, isLoading} = useAppsWithUpdates()
	const updateMut = useUpdateAppMutation()

	const updateAll = () => updatableApps.forEach((app) => updateMut.mutate({appId: app.id}))

	return {
		updateAll,
		isLoading,
		/** Something is left to start that isn't already updating */
		canUpdateAll: updatableApps.length > 0,
		/** Nothing left to start, and at least one update running */
		isUpdating: updatableApps.length === 0 && updatingApps.length > 0,
	}
}
