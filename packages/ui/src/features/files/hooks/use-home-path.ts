import {HOME_PATH, TRASH_PATH} from '@/features/files/constants'
import {trpcReact} from '@/trpc/trpc'

// The current account's home root. The owner's is /Home, a member's is
// /Users/<slug>. Sourced from user.get so the file browser roots correctly per
// account.
export function useHomePath(): string {
	const {data} = trpcReact.user.get.useQuery()
	return data?.homePath ?? HOME_PATH
}

// The current account's trash root (a sibling of their home).
export function useTrashPath(): string {
	const homePath = useHomePath()
	return homePath === HOME_PATH ? TRASH_PATH : `${homePath}/Trash`
}

// Whether the current account is a member (limited to their own files).
export function useIsMember(): boolean {
	const {data} = trpcReact.user.get.useQuery()
	return data?.role === 'member'
}
