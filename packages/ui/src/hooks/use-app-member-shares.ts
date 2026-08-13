import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

/**
 * Hook to manage apps shared with member accounts (owner only).
 */
export function useAppMemberShares({enabled = true}: {enabled?: boolean} = {}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()

	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'

	const {
		data: appMemberShares,
		isLoading: isLoadingAppMemberShares,
		isError: isErrorAppMemberShares,
	} = trpcReact.apps.memberShares.useQuery(undefined, {
		enabled: enabled && isOwner,
		staleTime: 15_000,
	})

	const shareForApp = (appId: string) => appMemberShares?.find((share) => share.appId === appId)

	const invalidate = async () => {
		await utils.apps.memberShares.invalidate()
	}

	const {mutateAsync: addAppMemberShare, isPending: isAddingAppMemberShare} = trpcReact.apps.addMemberShare.useMutation(
		{
			onSuccess: invalidate,
			onError: (error: RouterError) => {
				toast.error(t('app-share-users.share-failed'), {area: 'app-store', description: error.message})
			},
		},
	)

	const {mutateAsync: removeAppMemberShare, isPending: isRemovingAppMemberShare} =
		trpcReact.apps.removeMemberShare.useMutation({
			onSuccess: invalidate,
			onError: (error: RouterError) => {
				toast.error(t('app-share-users.unshare-failed'), {area: 'app-store', description: error.message})
			},
		})

	return {
		appMemberShares,
		isLoadingAppMemberShares,
		isErrorAppMemberShares,
		shareForApp,
		addAppMemberShare,
		isAddingAppMemberShare,
		removeAppMemberShare,
		isRemovingAppMemberShare,
	}
}
