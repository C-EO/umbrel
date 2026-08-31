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
	onLoad,
}: {
	item: Pick<Item, 'id' | 'tint'>
	size?: ThumbSize
	className?: string
	alt?: string
	loading?: 'eager' | 'lazy'
	// The loaded, decoded image — for reading its pixels
	onLoad?: (img: HTMLImageElement) => void
}) {
	const authorizedUrl = useSharedAuthorizedHttpUrl(itemThumbnailUrl(item.id, size))
	const [loaded, setLoaded] = useState(false)

	return (
		<div
			className={cn('relative overflow-hidden', item.tint === undefined && 'bg-white/6', className)}
			style={{backgroundColor: tintColor(item.tint)}}
		>
			{authorizedUrl && (
				<img
					src={authorizedUrl}
					alt={alt}
					draggable={false}
					decoding='async'
					fetchPriority='low'
					loading={loading}
					onLoad={(event) => {
						setLoaded(true)
						onLoad?.(event.currentTarget)
					}}
					className={cn(
						'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
						loaded ? 'opacity-100' : 'opacity-0',
					)}
				/>
			)}
		</div>
	)
}
