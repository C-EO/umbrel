import {useQueryClient} from '@tanstack/react-query'
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'

import {toast} from '@/components/ui/toast'
import {
	cloudSyncName,
	wasSyncRemovedByUser,
	type CloudSync,
	type CloudSyncActivity,
} from '@/features/files/hooks/use-cloud'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

type CloudActivityContextValue = {
	// Latest sanitized progress snapshot for clouds with active transfers
	activities: CloudSyncActivity[]
}

const CloudActivityContext = createContext<CloudActivityContextValue>({activities: []})

export function CloudActivityProvider({children}: {children: React.ReactNode}) {
	const utils = trpcReact.useUtils()
	const [activities, setActivities] = useState<CloudSyncActivity[]>([])
	const {data: currentAccount} = trpcReact.user.get.useQuery()
	const activityVersionRef = useRef(0)

	const applyActivitySnapshot = useCallback((snapshot: CloudSyncActivity[]) => {
		activityVersionRef.current += 1
		setActivities(snapshot)
	}, [])

	// If the socket fails, keep the last known state on screen until an
	// authoritative query succeeds. A version check prevents a slow recovery
	// query from overwriting a newer event delivered after reconnection.
	const reconcileActivity = useCallback(async () => {
		const startingVersion = activityVersionRef.current
		const snapshot = await utils.client.files.cloud.activity.query().catch(() => undefined)
		if (snapshot && activityVersionRef.current === startingVersion) applyActivitySnapshot(snapshot)
	}, [applyActivitySnapshot, utils])

	// Subscribe to the progress stream. Snapshots arrive ~1s apart while any
	// cloud transfers; ids drop out of the payload when their run ends. The
	// backend seeds every subscription and reconnection with its current state.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:cloud-progress'},
		{
			onData(data) {
				applyActivitySnapshot(data as CloudSyncActivity[])
			},
			onError(error) {
				console.error('eventBus.listen(files:cloud-progress) subscription error', error)
				void reconcileActivity()
			},
		},
	)

	// Poll cloud records only while transfers are active; other surfaces mount
	// their own queries when visible. The last seen records are kept in a ref so
	// a record that disappears can still be identified after the query disables.
	const cloudsQuery = trpcReact.files.cloud.syncs.useQuery(undefined, {
		enabled: activities.length > 0,
		refetchInterval: activities.length > 0 ? 5_000 : false,
	})

	const knownCloudsRef = useRef(new Map<string, CloudSync>())
	useEffect(() => {
		for (const item of cloudsQuery.data ?? []) knownCloudsRef.current.set(item.id, item)
	}, [cloudsQuery.data])

	// Refetch the actively observed listing queries at or under the given
	// clouds' destinations so files appear in the open folder while a transfer
	// runs. The backend's watcher events are not consumed by the UI, so without
	// this an open listing only refreshes on remount.
	const queryClient = useQueryClient()
	const lastListingRefreshRef = useRef(0)
	const refreshListingsUnder = useCallback(
		(cloudIds: Iterable<string>) => {
			const destinations = [...cloudIds]
				.map((id) => knownCloudsRef.current.get(id)?.destination.path)
				.filter((path): path is string => Boolean(path))
			if (destinations.length === 0) return
			queryClient.invalidateQueries({
				predicate: (query) => {
					const [route, options] = query.queryKey as [unknown, {input?: {path?: unknown}} | undefined]
					if (!Array.isArray(route) || route[0] !== 'files' || route[1] !== 'list') return false
					const path = options?.input?.path
					return (
						typeof path === 'string' &&
						destinations.some((destination) => path === destination || path.startsWith(`${destination}/`))
					)
				},
			})
		},
		[queryClient],
	)

	const lastActivityRef = useRef(new Map<string, CloudSyncActivity>())
	const activeIdsRef = useRef(new Set<string>())
	useEffect(() => {
		applyActivitySnapshot([])
		knownCloudsRef.current.clear()
		lastActivityRef.current.clear()
		activeIdsRef.current.clear()
		void reconcileActivity()
	}, [applyActivitySnapshot, currentAccount?.userId, reconcileActivity])

	useEffect(() => {
		const currentIds = new Set(activities.map(({syncId}) => syncId))
		for (const activity of activities) lastActivityRef.current.set(activity.syncId, activity)

		const endedIds = [...activeIdsRef.current].filter((id) => !currentIds.has(id))
		activeIdsRef.current = currentIds

		// Throttled live refresh of open listings under transferring destinations
		if (activities.length > 0) {
			const now = Date.now()
			if (now - lastListingRefreshRef.current >= 2000) {
				lastListingRefreshRef.current = now
				refreshListingsUnder(currentIds)
			}
		}

		if (endedIds.length === 0) return
		// One final refresh so the completed file set is visible immediately
		refreshListingsUnder(endedIds)

		// A transfer ended: refresh records, and give one-time clouds an ending.
		// The backend removes a one-time record on success, so a known one-time id
		// that is gone from the fresh list completed, unless the user removed the
		// download or disconnected the account themselves.
		void (async () => {
			await utils.files.cloud.syncs.invalidate()
			const clouds = await utils.client.files.cloud.syncs.query().catch(() => undefined)
			if (!clouds) return
			const remainingIds = new Set(clouds.map(({id}) => id))
			for (const id of endedIds) {
				const known = knownCloudsRef.current.get(id)
				if (known?.mode === 'one-time' && !remainingIds.has(id)) {
					if (!wasSyncRemovedByUser(id)) {
						const files = lastActivityRef.current.get(id)?.transferredFiles
						toast.success(
							files
								? t('files-cloud.downloaded-toast-files', {folder: cloudSyncName(known), count: files})
								: t('files-cloud.downloaded-toast', {folder: cloudSyncName(known)}),
						)
					}
					knownCloudsRef.current.delete(id)
					lastActivityRef.current.delete(id)
				}
			}
		})()
	}, [activities, utils, refreshListingsUnder])

	const value = useMemo(() => ({activities}), [activities])

	return <CloudActivityContext value={value}>{children}</CloudActivityContext>
}

export function useCloudActivity() {
	return useContext(CloudActivityContext)
}

// An activity represents real work once a file is queued to transfer. During
// rclone's scan/check phase totalFiles stays unset and no bytes move, so
// no-op syncs never count as work.
export function cloudActivityHasWork(activity: CloudSyncActivity) {
	return activity.totalFiles !== undefined || activity.transferredBytes > 0
}
