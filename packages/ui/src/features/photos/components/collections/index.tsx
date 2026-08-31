import {TbLoader} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {AlbumCard} from '@/features/photos/components/albums/album-card'
import {FadedScroller} from '@/features/photos/components/listing/faded-scroller'
import {ListingSurface} from '@/features/photos/components/listing/surface'
import {BASE_ROUTE_PATH} from '@/features/photos/constants'
import {useAlbums} from '@/features/photos/hooks/use-library'
import {DockSpacer} from '@/modules/desktop/dock'

// Albums as cover cards; each opens the album's timeline. Laid out like the
// timeline: edge to edge on the listing surface, starting under the actions
// bar and dissolving into it when scrolled.
// People and Locations are cut from v1 — their round/square cover-tile grid
// lived here too (kind: 'people' | 'locations'); restore it from git when
// face/geo clustering ships.
export function CollectionsListing({kind}: {kind: 'albums'}) {
	const navigate = useNavigate()
	const albums = useAlbums({enabled: kind === 'albums'})

	return (
		<ListingSurface>
			{(frame) =>
				albums.isLoading ? (
					<div className='flex h-full items-center justify-center' style={{paddingTop: frame.inset}}>
						<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
					</div>
				) : (
					<FadedScroller frame={frame}>
						{/* A little side room, so a card lifting on hover isn't clipped at the scroller's edges */}
						<div
							className='grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5 px-1.5 lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
							style={{paddingTop: frame.inset}}
						>
							{(albums.data ?? []).map((album) => (
								<AlbumCard
									key={album.id}
									album={album}
									className='aspect-[10/7]'
									onClick={() => navigate(`${BASE_ROUTE_PATH}/albums/${album.id}`)}
								/>
							))}
						</div>
						{/* Room at the end: for the last row to clear the dock the surface runs beneath */}
						<DockSpacer />
					</FadedScroller>
				)
			}
		</ListingSurface>
	)
}
