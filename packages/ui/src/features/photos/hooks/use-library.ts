import {useItemCache} from '@/features/photos/hooks/use-items'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

export type Album = RouterOutput['photos']['albums']['list'][number]
export type LibrarySummary = RouterOutput['photos']['library']['summary']

type QueryOptions = {enabled?: boolean}
export const useLibrarySummary = () => trpcReact.photos.library.summary.useQuery()
export const useLibraryStatus = () => trpcReact.photos.library.status.useQuery()
export const useAlbums = (options?: QueryOptions) => trpcReact.photos.albums.list.useQuery(undefined, options)
// People and Locations are cut from v1 — usePeople/useLocations (and their
// Person/Location types) come back with the photos.people/locations routers

export function useAlbumActions() {
	const utils = trpcReact.useUtils()
	const {remove: dropFromLists} = useItemCache()
	const refresh = () => utils.photos.invalidate()
	const create = trpcReact.photos.albums.create.useMutation({onSuccess: refresh})
	const rename = trpcReact.photos.albums.rename.useMutation({onSuccess: refresh})
	const setCover = trpcReact.photos.albums.setCover.useMutation({onSuccess: refresh})
	const remove = trpcReact.photos.albums.delete.useMutation({onSuccess: refresh})
	const addItems = trpcReact.photos.albums.addItems.useMutation({onSuccess: refresh})
	// The items leave the album's list at once; its count and cover follow with the refresh
	const removeItems = trpcReact.photos.albums.removeItems.useMutation({
		onMutate: ({id, ids}) => dropFromLists(ids, (filter) => filter.albumIds?.includes(id) ?? false),
		onSuccess: refresh,
		onError: refresh,
	})
	return {
		createAlbum: create.mutateAsync,
		renameAlbum: rename.mutateAsync,
		setCover: setCover.mutateAsync,
		deleteAlbum: remove.mutateAsync,
		addToAlbum: addItems.mutateAsync,
		removeFromAlbum: removeItems.mutateAsync,
	}
}
