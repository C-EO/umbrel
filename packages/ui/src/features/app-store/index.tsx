import {Outlet, useLocation} from 'react-router-dom'

import {SearchResults} from '@/features/app-store/components/search-results'
import {StoreHeader} from '@/features/app-store/components/store-header'
import {UpdatesShelf} from '@/features/app-store/components/updates-shelf'
import {categoryPath, DISCOVER_PATH} from '@/features/app-store/constants'
import {useStoreSearch} from '@/features/app-store/hooks/use-store-search'
import {StoreActionsProvider} from '@/features/app-store/providers/store-actions'
import {trpcReact} from '@/trpc/trpc'

// The store shell: the collapsing header chrome (title, search, owner-only
// updates + community-store controls, category rail — see store-header.tsx),
// then the page content. Search swaps the page content for local results;
// everything else renders through the Outlet.
export default function AppStoreLayout() {
	const location = useLocation()

	// Members browse the app store read-only; updating apps and managing
	// community app stores are owner features
	const isOwner = trpcReact.user.get.useQuery().data?.role === 'owner'

	const search = useStoreSearch()

	return (
		<StoreActionsProvider>
			<div className='flex flex-col gap-4 md:gap-5'>
				<StoreHeader search={search} isOwner={isOwner} />
				<div className='flex flex-col gap-4 md:gap-5'>
					{/* Maintenance before discovery: updates lead the two landing pages,
					    Discover and All apps (Discover's stand-in when the feed is
					    unavailable) — category pages get straight to their grid; the
					    header's updates chip keeps updates reachable everywhere */}
					{!search.deferredQuery && [DISCOVER_PATH, categoryPath('all')].includes(location.pathname) && (
						<UpdatesShelf />
					)}
					{/* Keyed by page identity so switching category (same route, new
					    params) remounts the content and replays its gentle reveal —
					    typing within search keeps one stable key */}
					<div key={search.deferredQuery ? 'search' : location.pathname} className='flex flex-col gap-4 md:gap-5'>
						{search.deferredQuery ? <SearchResults query={search.deferredQuery} /> : <Outlet />}
					</div>
				</div>
			</div>
		</StoreActionsProvider>
	)
}
