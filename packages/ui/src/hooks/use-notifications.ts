import {keepPreviousData} from '@tanstack/react-query'

import {trpcReact} from '@/trpc/trpc'

/**
 * Hook to query and clear system notifications
 */
export function useNotifications() {
	const utils = trpcReact.useUtils()

	// Query to fetch notifications
	const {
		data: notifications = [],
		isLoading,
		isError,
		error,
	} = trpcReact.notifications.get.useQuery(undefined, {
		placeholderData: keepPreviousData,
		// Events provide immediate updates; polling is a low-frequency fallback
		// in case a live subscription misses a change without reconnecting.
		refetchInterval: 30_000,
	})

	// Notifications can be created by background work (e.g. device hot-plug)
	// without a UI mutation, so live-update from the event bus while mounted
	trpcReact.eventBus.listen.useSubscription(
		{event: 'notifications:change'},
		{
			// Refetch on every (re)connect so a dropped websocket can't leave the
			// list frozen on a stale snapshot (onStarted fires on reconnect too)
			onStarted: () => utils.notifications.get.invalidate(),
			onData: () => utils.notifications.get.invalidate(),
			onError: (error) => console.error('notifications:change subscription error', error),
		},
	)

	// Mutation to clear a notification
	const clearNotification = trpcReact.notifications.clear.useMutation({
		onMutate: async (notificationToRemove: string) => {
			await utils.notifications.get.cancel()
			const previousNotifications = utils.notifications.get.getData()

			// Optimistically update the notifications list
			utils.notifications.get.setData(undefined, (old = []) => old.filter((n) => n !== notificationToRemove))

			return {previousNotifications}
		},
		onSettled: () => {
			utils.notifications.get.invalidate()
		},
	})

	return {
		notifications,
		clearNotification: (notification: string) => clearNotification.mutate(notification),
		isLoading,
		isError,
		error,
	}
}
