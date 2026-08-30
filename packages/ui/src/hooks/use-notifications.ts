import {keepPreviousData} from '@tanstack/react-query'

import {trpcReact} from '@/trpc/trpc'

/** Added by umbreld at registration; drives the welcome desktop until dismissed */
export const ONBOARDING_COMPLETE_NOTIFICATION = 'onboarding-complete'

/** The current account's notifications; the list is shared query state */
export function useNotificationsQuery() {
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
	return {notifications, isLoading, isError, error}
}

/** Clears a notification, optimistically removing it from the list */
export function useClearNotification() {
	const utils = trpcReact.useUtils()
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
	return (notification: string) => clearNotification.mutate(notification)
}

/**
 * Query, live-update and clear notifications. Holds the event-bus
 * subscription, so mount it once (the always-present Notifications route);
 * other readers use useNotificationsQuery and useClearNotification.
 */
export function useNotifications() {
	const utils = trpcReact.useUtils()

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

	return {...useNotificationsQuery(), clearNotification: useClearNotification()}
}
