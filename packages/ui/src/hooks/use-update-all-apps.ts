import {trpcReact} from '@/trpc/trpc'

import {useAppsWithUpdates} from './use-apps-with-updates'

export function useUpdateAllApps() {
	const utils = trpcReact.useUtils()
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()
	const updateMut = trpcReact.apps.update.useMutation({
		onMutate: ({appId}) => {
			// Optimistic updates because otherwise it's too slow and feels like nothing is happening
			utils.apps.state.cancel()
			utils.apps.state.setData({appId}, {state: 'updating', progress: 0})
		},
		onSuccess: () => utils.apps.list.invalidate(),
	})

	const updateAll = () => {
		appsWithUpdates.filter((app) => app.compatible).forEach((app) => updateMut.mutate({appId: app.id}))
	}

	const isUpdating = updateMut.isPending

	return {updateAll, isLoading, isUpdating}
}
