import {useState} from 'react'

import {dashboardAuthHeaders} from '@/modules/auth/http-auth'
import {trpcReact} from '@/trpc/trpc'

export type AccountAvatarResponse = {userId: string; avatarUrl: string | null}

async function avatarResponse(response: Response): Promise<AccountAvatarResponse> {
	const data = (await response.json().catch(() => undefined)) as
		| {userId?: unknown; avatarUrl?: unknown; error?: unknown}
		| undefined
	if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to save avatar')
	if (typeof data?.userId !== 'string' || (data.avatarUrl !== null && typeof data.avatarUrl !== 'string')) {
		throw new Error('Invalid avatar response')
	}
	return {userId: data.userId, avatarUrl: data.avatarUrl}
}

export async function uploadAccountAvatar(userId: string, file: File) {
	return avatarResponse(
		await fetch(`/api/accounts/${encodeURIComponent(userId)}/avatar`, {
			method: 'PUT',
			headers: dashboardAuthHeaders(),
			body: file,
		}),
	)
}

export async function deleteAccountAvatar(userId: string) {
	return avatarResponse(
		await fetch(`/api/accounts/${encodeURIComponent(userId)}/avatar`, {
			method: 'DELETE',
			headers: dashboardAuthHeaders(),
		}),
	)
}

export function useAccountAvatar() {
	const utils = trpcReact.useUtils()
	const [isPending, setIsPending] = useState(false)

	const updateCaches = (result: AccountAvatarResponse) => {
		const avatarUrl = result.avatarUrl ?? undefined
		utils.user.listAccounts.setData(undefined, (accounts) =>
			accounts?.map((account) => (account.userId === result.userId ? {...account, avatarUrl} : account)),
		)
		utils.user.get.setData(undefined, (account) =>
			account?.userId === result.userId ? {...account, avatarUrl} : account,
		)
		void Promise.all([utils.user.listAccounts.invalidate(), utils.user.get.invalidate()])
		return result
	}

	const mutate = async (request: () => Promise<AccountAvatarResponse>) => {
		setIsPending(true)
		try {
			return updateCaches(await request())
		} finally {
			setIsPending(false)
		}
	}

	return {
		isPending,
		upload: (userId: string, file: File) => mutate(() => uploadAccountAvatar(userId, file)),
		remove: (userId: string) => mutate(() => deleteAccountAvatar(userId)),
	}
}
