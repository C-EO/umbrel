import {keepPreviousData} from '@tanstack/react-query'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {HOME_PATH} from '@/features/files/constants'
import {useIsMember} from '@/features/files/hooks/use-home-path'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

/**
 * Hook to manage external storage devices.
 * Provides functionality to fetch and eject external storage devices.
 */
export function useExternalStorage() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	// External storage is an owner-only feature, don't run its queries for
	// member accounts. Note this must key off 'not a member' rather than 'is the
	// owner' because this hook is also used during onboarding before any user
	// (or token) exists, e.g. the backup restore flow.
	const isMember = useIsMember()
	const isExternalStorageSupported = true

	// Subscribe to files:external-storage:change events that fire when devices are mounted/unmounted
	// and invalidate the external storage queries
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:external-storage:change'},
		{
			enabled: !isMember,
			onData() {
				utils.files.externalDevices.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(files:external-storage:change) subscription error', err)
			},
		},
	)

	// Query for external storage
	const {data: disks, isLoading: isLoadingDisks} = trpcReact.files.externalDevices.useQuery(undefined, {
		placeholderData: keepPreviousData,
		refetchInterval: 5000, // Poll because the change event cannot fire after a device has already been physically removed
		staleTime: 0, // Don't cache the data
		enabled: !isMember,
	})
	const {currentPath, navigateToDirectory} = useNavigate()

	// Eject disk mutation
	// TODO: The externalDevices query has a 5s polling interval and a WebSocket subscription that
	// both trigger invalidation. These can refetch and undo the optimistic removal before the server
	// finishes ejecting, causing the disk to briefly flash back. May need to pause polling/subscription
	// during the mutation to fully prevent this.
	const {mutateAsync: ejectDisk, isPending: isEjecting} = trpcReact.files.unmountExternalDevice.useMutation({
		onMutate: async (id) => {
			const ejectedDisk = disks?.find((disk) => disk.id === id.deviceId)

			// Cancel the sidebar query we're about to optimistically update
			await utils.files.externalDevices.cancel()

			// Snapshot sidebar data for rollback
			const previousDisks = utils.files.externalDevices.getData()

			// Optimistically remove the disk from the sidebar
			utils.files.externalDevices.setData(undefined, (old) => old?.filter((disk) => disk.id !== id.deviceId))

			// Optimistically remove the disk's partitions from the directory listing via pendingPaths
			const ejectedPaths = ejectedDisk?.partitions.flatMap((p) => p.mountpoints) ?? []
			if (ejectedPaths.length > 0) {
				useFilesStore.getState().addPendingPaths(ejectedPaths, 'removing')
			}

			// Navigate away immediately if the user is browsing the ejected disk
			if (
				ejectedDisk &&
				ejectedDisk.partitions.some((partition) =>
					partition.mountpoints.some((mountpoint) => currentPath.startsWith(mountpoint)),
				)
			) {
				navigateToDirectory(HOME_PATH)
			}

			return {ejectedDisk, previousDisks, ejectedPaths}
		},
		onError: (error: RouterError, _, context) => {
			// Rollback optimistic updates
			if (context?.previousDisks) {
				utils.files.externalDevices.setData(undefined, context.previousDisks)
			}
			if (context?.ejectedPaths?.length) {
				useFilesStore.getState().removePendingPaths(context.ejectedPaths)
			}
			toast.error(t('files-error.eject-disk', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
		onSettled: () => {
			utils.files.externalDevices.invalidate()
		},
	})

	// Format disk mutation
	const {mutateAsync: formatExternalStorageDevice, isPending: isFormatting} =
		trpcReact.files.formatExternalDevice.useMutation({
			onError: (error: RouterError) => {
				toast.error(error.message || t('files-format.error'), {area: 'files'})
			},
			onSettled: () => {
				utils.files.externalDevices.invalidate()
			},
		})

	return {
		disks,
		isLoadingExternalStorage: isLoadingDisks,
		ejectDisk,
		isEjecting,
		formatExternalStorageDevice,
		isFormatting,
		isExternalStorageSupported,
	}
}
