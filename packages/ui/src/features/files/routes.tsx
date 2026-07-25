import {lazy} from 'react'
import {Navigate, RouteObject} from 'react-router-dom'

import {AppsListing} from '@/features/files/components/listing/apps-listing'
import {DirectoryListing} from '@/features/files/components/listing/directory-listing'
import {RecentsListing} from '@/features/files/components/listing/recents-listing'
import {SearchListing} from '@/features/files/components/listing/search-listing'
import {TrashListing} from '@/features/files/components/listing/trash-listing'
import {BASE_ROUTE_PATH, HOME_PATH, TRASH_PATH} from '@/features/files/constants'
import {useTrashPath} from '@/features/files/hooks/use-home-path'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {trpcReact} from '@/trpc/trpc'

const Files = lazy(() => import('@/features/files'))

// Redirect /files to the current account's home (owner: /Home, member: /Users/<slug>).
// Wait for user.get before redirecting — the redirect unmounts immediately, so
// navigating on the '/Home' loading fallback would strand members in the
// owner's namespace.
function FilesIndexRedirect() {
	const {data, isLoading} = trpcReact.user.get.useQuery()
	if (isLoading) return null
	return <Navigate to={`${BASE_ROUTE_PATH}${data?.homePath ?? HOME_PATH}`} replace />
}

// A member's trash lives under their home (/Users/<slug>/Trash) so it can't be
// matched by the static Trash/* route, detect it here instead
function DirectoryOrTrashListing() {
	const trashPath = useTrashPath()
	const {currentPath} = useNavigate()
	const isMemberTrash =
		trashPath !== TRASH_PATH && (currentPath === trashPath || currentPath.startsWith(`${trashPath}/`))
	if (isMemberTrash) return <TrashListing />
	return <DirectoryListing />
}

export const filesRoutes: RouteObject[] = [
	{
		path: 'files',
		element: <Files />,
		children: [
			// if the user navigates to /files, redirect to their home
			{
				index: true,
				element: <FilesIndexRedirect />,
			},
			// "Recents" and not "Recents/*" because folders aren't tracked in the recents by the server
			{
				path: 'Recents',
				element: <RecentsListing />,
			},
			{
				// "Search" and not "Search/*" because folders aren't tracked in the search by the server
				path: 'Search',
				element: <SearchListing />,
			},
			{
				// "Apps" and not "Apps/*" because we want to allow uploads, new folders, etc. in "Apps/<app-data>/*""
				// which would instead be rendered by the DirectoryListing component
				path: 'Apps',
				element: <AppsListing />,
			},
			{
				// "Trash/*" and not "Trash" because we want to disable new folder, upload, etc.
				// in the entire Trash directory and its subdirectories
				path: 'Trash/*',
				element: <TrashListing />,
			},
			{
				path: '*',
				element: <DirectoryOrTrashListing />,
			},
		],
	},
]
