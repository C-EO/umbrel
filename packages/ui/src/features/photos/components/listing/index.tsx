import {Plus, TriangleAlert} from 'lucide-react'
import {useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useParams} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {CollectionsListing} from '@/features/photos/components/collections'
import {ListingSurface, type Frame} from '@/features/photos/components/listing/surface'
import {TimelineGrid} from '@/features/photos/components/listing/timeline-grid'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePhotosView} from '@/features/photos/components/view-context'
import {isCollectionSection} from '@/features/photos/constants'
import {useItems, type ItemFilter} from '@/features/photos/hooks/use-items'
import {useLibraryStatus} from '@/features/photos/hooks/use-library'

import {useRouteFilter} from './route-filter'

export {useRouteFilter} from './route-filter'

export function PhotosListing() {
	const {section} = useParams()
	if (isCollectionSection(section)) return <CollectionsListing kind={section} />
	return <Timeline />
}

function Timeline() {
	const filter = useRouteFilter()
	const {search} = usePhotosView()
	const {data: indexingState, isLoading: isLoadingState} = useLibraryStatus()
	const hasShownReadyLibrary = useRef(false)
	if (indexingState?.phase === 'ready') hasShownReadyLibrary.current = true
	// While a search is refining, the last results stay up until the next
	// arrive — the grid narrows in steps rather than blinking through a
	// spinner on every applied keystroke
	const incrementalEnrichment = indexingState?.phase === 'enriching' && hasShownReadyLibrary.current
	const libraryQueryable =
		indexingState?.phase === 'ready' || indexingState?.phase === 'degraded' || incrementalEnrichment
	const {items, isLoading, hasMore, loadMore} = useItems(filter, {
		enabled: libraryQueryable,
		keepPrevious: search.active,
	})
	// A new filter is a new list: remount so scroll position and row cache start clean
	const listKey = JSON.stringify(filter)

	return (
		<ListingSurface>
			{(frame) =>
				isLoadingState || indexingState?.phase === 'indexing' ? (
					<Indexing frame={frame} />
				) : indexingState?.phase === 'enriching' && !incrementalEnrichment ? (
					<Enriching frame={frame} percentage={indexingState.percentage} />
				) : isLoading ? (
					<div className='flex h-full items-center justify-center' style={{paddingTop: frame.inset}}>
						<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
					</div>
				) : items.length === 0 ? (
					<>
						{indexingState?.phase === 'degraded' && <DegradedNotice />}
						{incrementalEnrichment && <EnrichmentNotice percentage={indexingState.percentage} />}
						<Empty filter={filter} frame={frame} />
					</>
				) : (
					<>
						{indexingState?.phase === 'degraded' && <DegradedNotice />}
						{incrementalEnrichment && <EnrichmentNotice percentage={indexingState.percentage} />}
						<TimelineGrid
							key={listKey}
							items={items}
							hasMore={hasMore}
							loadMore={loadMore}
							frame={frame}
							inDeleted={filter.deleted === true}
						/>
					</>
				)
			}
		</ListingSurface>
	)
}

function EnrichmentNotice({percentage}: {percentage: number}) {
	const {t} = useTranslation()
	return (
		<div className='pointer-events-none absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-12 text-white/70 shadow-lg backdrop-blur-xl'>
			<TbLoader className='size-3.5 animate-spin' />
			{t('photos-enriching.background', {percentage})}
		</div>
	)
}

function DegradedNotice() {
	const {t} = useTranslation()
	return (
		<div className='pointer-events-none absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300/15 bg-amber-950/80 px-3 py-1.5 text-12 text-amber-100 shadow-lg backdrop-blur-xl'>
			<TriangleAlert className='size-3.5' />
			{t('photos-degraded.description')}
		</div>
	)
}

function Indexing({frame}: {frame: Frame}) {
	const {t} = useTranslation()
	return (
		<div
			className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
			<p className='text-15 font-medium text-white/80'>{t('photos-indexing.title')}</p>
			<p className='text-13 text-white/50'>{t('photos-indexing.description')}</p>
		</div>
	)
}

function Enriching({frame, percentage}: {frame: Frame; percentage: number}) {
	const {t} = useTranslation()
	return (
		<div
			className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<p className='text-15 font-medium text-white/80'>{t('photos-enriching.title')}</p>
			<p className='text-13 text-white/50'>{t('photos-enriching.description', {percentage})}</p>
			<div className='mt-2 h-1.5 w-52 overflow-hidden rounded-full bg-white/10'>
				<div className='h-full rounded-full bg-white/70 transition-[width]' style={{width: `${percentage}%`}} />
			</div>
		</div>
	)
}

// Nothing to show. A search that found nothing says so and offers the way
// out; an empty album says so and offers to fill it — the way in is picking
// items from the library — unless that is already under way
function Empty({frame}: {filter: ItemFilter; frame: Frame}) {
	const {t} = useTranslation()
	const selection = usePhotosSelection()
	const {search} = usePhotosView()
	// An album with nothing in it, as opposed to a search that finds nothing
	// there — from the route, not the filter (a search token also fills albumIds)
	const routeAlbumId = useParams().albumId
	const albumId = search.active ? undefined : routeAlbumId
	return (
		<div
			className='flex h-full flex-col items-center justify-center gap-1 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<p className='text-15 font-medium text-white/80'>
				{search.active
					? t('photos-search.no-results-title')
					: albumId
						? t('photos-album.empty-title')
						: t('photos-listing.empty-title')}
			</p>
			<p className='text-13 text-white/50'>
				{search.active
					? t('photos-search.no-results-description')
					: albumId
						? t('photos-album.empty-description')
						: t('photos-listing.empty-description')}
			</p>
			{search.active && (
				<PillButton className='mt-3' onClick={search.clear}>
					{t('photos-search.clear')}
				</PillButton>
			)}
			{albumId && !selection.pickingFor && (
				<PillButton icon={Plus} className='mt-3' onClick={() => selection.pickFor(albumId)}>
					{t('photos-album.add-items')}
				</PillButton>
			)}
		</div>
	)
}
