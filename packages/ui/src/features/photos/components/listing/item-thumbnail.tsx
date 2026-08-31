import {useState} from 'react'

import {itemThumbnailUrl, type Item, type ThumbSize} from '@/features/photos/hooks/use-items'
import {cn} from '@/lib/utils'
import {useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'

// The photo's own average colour, as CSS. A tile is its photograph's colour
// from the frame it exists, so a page of them arrives as a picture of the
// library that sharpens rather than as a wall of grey holes — and the
// arriving photograph is a sharpening rather than a change of colour, which
// is why it reads as calm. Items with no tint keep the flat wash.
export const tintColor = (tint: number | undefined) =>
	tint === undefined ? undefined : `#${tint.toString(16).padStart(6, '0')}`

// The rendition a square tile of this many device pixels wants. The 192 —
// which is also the one the canvas draws its cells from, so the two renderers
// either side of the GPU seam share the browser's cache and neither crossing
// refetches what is on screen — covers the square as long as its short side
// does: 128 is a 3:2 photo's short side at 192-fit. Above that, the 512.
export const thumbSizeForTile = (devicePx: number): ThumbSize => (devicePx <= 128 ? 192 : 512)

// A thumbnail <img> for an item. The URL is derived from the id — every
// rendition always exists (see CONTRACT.md); `size` picks the one this
// surface needs. Eager by default: every list that renders these windows its
// own items, and a tile that springs into view during a reflow must already
// be fetching.
export function ItemThumbnail({
	item,
	size = 512,
	className,
	alt = '',
	loading = 'eager',
	warmUntil = 0,
	onLoad,
}: {
	item: Pick<Item, 'id' | 'tint'>
	size?: ThumbSize
	className?: string
	alt?: string
	loading?: 'eager' | 'lazy'
	// Until this moment (performance.now()), an arriving photograph is shown
	// at once rather than faded in from tint: the caller expects the pixels
	// in the browser's cache — the other renderer at the GPU seam just showed
	// them — and what was on screen a breath ago must not flash back through
	// its colour on the way in.
	warmUntil?: number
	// The loaded, decoded image — for reading its pixels
	onLoad?: (img: HTMLImageElement) => void
}) {
	// Renditions only ever sharpen. `fine` is the one being shown or fetched;
	// when `size` steps up, the loaded image stays mounted beneath as `coarse`
	// until the finer one arrives, so an upgrade never passes back through the
	// tint. A step down is ignored — the finer pixels already here cover it.
	const [fine, setFine] = useState(() => ({size, warmUntil}))
	const [coarse, setCoarse] = useState<ThumbSize | null>(null)
	const [loaded, setLoaded] = useState<'none' | 'instant' | 'fade'>('none')
	if (size > fine.size) {
		if (loaded !== 'none') setCoarse(fine.size)
		// A sharpening is instant — and the coarse layer hides the wait anyway
		setFine({size, warmUntil: Infinity})
		setLoaded('none')
	}
	const authorizedUrl = useSharedAuthorizedHttpUrl(itemThumbnailUrl(item.id, fine.size))
	const authorizedCoarseUrl = useSharedAuthorizedHttpUrl(
		coarse === null ? undefined : itemThumbnailUrl(item.id, coarse),
	)

	return (
		<div
			className={cn('relative overflow-hidden', item.tint === undefined && 'bg-white/6', className)}
			style={{backgroundColor: tintColor(item.tint)}}
		>
			{/* Keyed by rendition, so on an upgrade this is the element that was
			    `fine` a render ago — same node, same decoded pixels, no reload */}
			{coarse !== null && authorizedCoarseUrl && (
				<img
					key={coarse}
					src={authorizedCoarseUrl}
					alt=''
					aria-hidden
					draggable={false}
					decoding='async'
					className='absolute inset-0 h-full w-full object-cover'
				/>
			)}
			{authorizedUrl && (
				<img
					key={fine.size}
					src={authorizedUrl}
					alt={alt}
					draggable={false}
					decoding='async'
					fetchPriority='low'
					loading={loading}
					onLoad={(event) => {
						const img = event.currentTarget
						setLoaded(performance.now() < fine.warmUntil ? 'instant' : 'fade')
						// The coarse layer goes once the finer pixels can truly
						// paint; dropping it at the load event races the async decode
						if (coarse !== null) img.decode().then(dropCoarse, dropCoarse)
						onLoad?.(img)
					}}
					className={cn(
						'absolute inset-0 h-full w-full object-cover',
						loaded === 'fade' && 'transition-opacity duration-300',
						loaded === 'none' ? 'opacity-0' : 'opacity-100',
					)}
				/>
			)}
		</div>
	)

	function dropCoarse() {
		setCoarse(null)
	}
}
