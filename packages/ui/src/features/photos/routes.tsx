import {lazy} from 'react'
import {RouteObject} from 'react-router-dom'

import {PhotosListing} from '@/features/photos/components/listing'
import {SourcesOverview} from '@/features/photos/components/sources/sources-overview'

const Photos = lazy(() => import('@/features/photos'))

export const photosRoutes: RouteObject[] = [
	{
		path: 'photos',
		element: <Photos />,
		children: [
			// All (everything)
			{
				index: true,
				element: <PhotosListing />,
			},
			// Every source as a tile
			{
				path: 'sources',
				element: <SourcesOverview />,
			},
			// Sidebar sections (favorites, photos, videos, ...). All render the same
			// placeholder listing until each section gets its own view.
			{
				path: ':section',
				element: <PhotosListing />,
			},
			// One album: the timeline filtered to it. People and Locations are cut
			// from v1 — their routes come back with the backend:
			// {path: 'people/:personId', element: <PhotosListing />},
			// {path: 'locations/:locationId', element: <PhotosListing />},
			{path: 'albums/:albumId', element: <PhotosListing />},
			// A single source (this Umbrel, a phone, a drive, a NAS)
			{
				path: 'source/:sourceId',
				element: <PhotosListing />,
			},
		],
	},
]
