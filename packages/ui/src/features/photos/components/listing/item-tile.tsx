import {Check, Heart, Play, Sparkles} from 'lucide-react'
import {memo} from 'react'

import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import type {Item} from '@/features/photos/hooks/use-items'
import {tw} from '@/utils/tw'

function formatDuration(ms: number) {
	const total = Math.round(ms / 1000)
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The selection circle's corner of a tile: how big a tile must be to show
// it, and the square (from the top-left corner) a click in counts as a click
// on it. The circle is a pseudo-element with no element of its own, so
// TileLayer tells the two clicks apart with this. Mirrored by the classes
// below (`@min-[72px]`, `top-1.5 left-1.5 size-[22px]`).
export const SELECT_CIRCLE = {minTile: 72, hitSize: 36} as const

// The tile's classes, one string per state so a render does no class work.
// The hover wash and the empty circle are the button's pseudo-elements.
const tileClass = tw`group relative aspect-square w-full overflow-hidden rounded-(--umbrel-photos-tile-radius) outline-hidden focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset before:pointer-events-none before:absolute before:inset-0 before:z-10 hover:before:bg-white/8 after:pointer-events-none after:absolute after:top-1.5 after:left-1.5 after:z-10 after:hidden after:size-[22px] after:rounded-full after:border-[1.5px] after:border-white/85 after:bg-black/20 after:shadow-[0_1px_3px_rgb(0_0_0/0.35)]`
const tileClassByState = {
	idle: `${tileClass} @min-[72px]:hover:after:block`,
	selectable: `${tileClass} @min-[72px]:after:block`,
	selected: tileClass,
}

// One cell of the grid: thumbnail, kind badges, favorite mark and the
// selection circle. Deliberately just a picture — opening it, selecting it
// and its context menu are handled once for every tile by the layer around
// them (see TileLayer), so mounting a hundred of these at a new zoom stop
// costs no more than the DOM they add. Memoized: the grid re-renders on
// every scroll, reflow and selection change, and only a changed tile matters.
//
// Nothing is added to the DOM for selection until a tile is selected: the
// hover wash and the empty circle (shown on hover, and on every tile while
// `selectable`) are pseudo-elements, and only a selected tile mounts its
// ring and check. Every node here is multiplied by the hundreds of tiles a
// dense zoom stop mounts in one frame, and nothing transitions.
export const ItemTile = memo(function ItemTile({
	item,
	selected,
	selectable,
}: {
	item: Item
	selected: boolean
	selectable: boolean
}) {
	return (
		<button
			type='button'
			data-item-id={item.id}
			aria-pressed={selectable ? selected : undefined}
			className={tileClassByState[selected ? 'selected' : selectable ? 'selectable' : 'idle']}
		>
			<ItemThumbnail item={item} className='h-full w-full' />
			{/* Badges only once the tile is big enough to carry them (see TileSlot's container).
			    One corner shares them: 360° and duration can coexist on a video, Live is photos-only. */}
			{(item.subKind === 'live' || item.subKind === 'spherical' || item.durationMs !== undefined) && (
				<span className='absolute bottom-1.5 left-1.5 hidden items-center gap-1 @min-[88px]:flex'>
					{item.subKind === 'live' && (
						<span className='flex items-center rounded-full bg-black/55 p-1 text-white backdrop-blur-sm'>
							<Sparkles className='size-2.5' fill='currentColor' strokeWidth={0} />
						</span>
					)}
					{item.subKind === 'spherical' && (
						<span className='rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm'>
							360°
						</span>
					)}
					{item.kind === 'video' && item.durationMs !== undefined && (
						<span className='flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm'>
							<Play className='size-2.5' fill='currentColor' strokeWidth={0} />
							{formatDuration(item.durationMs)}
						</span>
					)}
				</span>
			)}
			{item.isFavorite && (
				<span className='absolute top-1.5 right-1.5 hidden text-white drop-shadow @min-[88px]:block'>
					<Heart className='size-3.5' fill='currentColor' strokeWidth={0} />
				</span>
			)}
			{selected && (
				<span className='pointer-events-none absolute inset-0 rounded-(--umbrel-photos-tile-radius) border-2 border-brand'>
					{/* 4px inside the 2px border: where the empty circle sits */}
					<span className='absolute top-1 left-1 hidden size-[22px] items-center justify-center rounded-full bg-brand text-white @min-[72px]:flex'>
						<Check className='size-3.5' strokeWidth={3} />
					</span>
				</span>
			)}
		</button>
	)
})
