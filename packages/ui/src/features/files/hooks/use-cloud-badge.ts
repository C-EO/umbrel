import {keepPreviousData} from '@tanstack/react-query'

import {trpcReact} from '@/trpc/trpc'

export type CloudBadge = {
	provider: string
	// The owning account, so the icon can resolve WebDAV flavor branding
	accountId: string
	// syncing: a run is active or queued; attention: the download needs the user
	state: 'syncing' | 'attention' | 'idle'
}

// Narrow, per-icon subscription to the clouds query. Rendered for every
// directory icon, so it subscribes directly (not via useCloudSyncs, which
// callers use for full records) and uses react-query `select` to return a
// small object: the provider id and badge state when this path is a download
// destination, or null. Structural sharing keeps the result stable across
// poll ticks, so an icon only rerenders when its own badge actually changes,
// and requests stay deduplicated across observers.
export function useCloudBadge(path: string): CloudBadge | null {
	// Rewind snapshots list items under /Backups/<mount>/Home/...; strip the
	// mount prefix so a snapshot view of a download destination still shows its
	// badge (mirroring how FileItemIcon resolves app folders in snapshots)
	const normalizedPath = path.startsWith('/Backups/') ? path.replace(/^\/Backups\/[^/]+(?=\/)/, '') : path
	const {data: accounts} = trpcReact.files.cloud.accounts.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 15_000,
	})

	const {data: badge} = trpcReact.files.cloud.syncs.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 5_000,
		refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 5_000 : false),
		select: (clouds): CloudBadge | null => {
			const match = clouds.find(({destination}) => destination.path === normalizedPath)
			if (!match) return null
			const account = accounts?.find(({id}) => id === match.accountId)
			if (!account) return null
			const state =
				match.status.state === 'running' || match.status.state === 'queued'
					? ('syncing' as const)
					: match.status.state === 'needs-attention'
						? ('attention' as const)
						: ('idle' as const)
			return {provider: account.provider, accountId: match.accountId, state}
		},
	})
	return badge ?? null
}
