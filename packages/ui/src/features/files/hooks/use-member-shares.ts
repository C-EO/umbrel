import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

/**
 * Hook to manage paths shared with member accounts (owner only) and, for
 * members, the paths that have been shared with them.
 */
export function useMemberShares({enabled = true}: {enabled?: boolean} = {}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()

	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'
	const isMember = userQ.data?.role === 'member'

	// All member shares (owner management)
	const {
		data: memberShares,
		isLoading: isLoadingMemberShares,
		isError: isErrorMemberShares,
	} = trpcReact.files.memberShares.useQuery(undefined, {
		enabled: enabled && isOwner,
		staleTime: 15_000,
	})

	// The paths shared with the current member account
	const {data: sharedWithMe, isLoading: isLoadingSharedWithMe} = trpcReact.files.sharedWithMe.useQuery(undefined, {
		enabled: enabled && isMember,
		staleTime: 15_000,
	})

	const shareForPath = (path: string) => memberShares?.find((share) => share.path === path)

	const invalidate = async () => {
		await Promise.all([utils.files.memberShares.invalidate(), utils.files.sharedWithMe.invalidate()])
	}

	const {mutateAsync: addMemberShare, isPending: isAddingMemberShare} = trpcReact.files.addMemberShare.useMutation({
		onSuccess: invalidate,
		onError: (error: RouterError) => {
			toast.error(t('files-share-users.share-failed', {message: getFilesErrorMessage(error.message)}))
		},
	})

	const {mutateAsync: removeMemberShare, isPending: isRemovingMemberShare} =
		trpcReact.files.removeMemberShare.useMutation({
			onSuccess: invalidate,
			onError: (error: RouterError) => {
				toast.error(t('files-share-users.unshare-failed', {message: getFilesErrorMessage(error.message)}))
			},
		})

	return {
		memberShares,
		isLoadingMemberShares,
		isErrorMemberShares,
		shareForPath,
		sharedWithMe,
		isLoadingSharedWithMe,
		addMemberShare,
		isAddingMemberShare,
		removeMemberShare,
		isRemovingMemberShare,
	}
}
