import {useTranslation} from 'react-i18next'

import {ALBUM_STYLES, albumStyleId, fontSpec, formatAlbumDates} from '@/features/photos/components/albums/album-style'
import {useCoverTone} from '@/features/photos/components/albums/use-cover-tone'
import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import type {Album} from '@/features/photos/hooks/use-library'
import {useFontReady} from '@/hooks/use-font-ready'
import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'

// An album as a cover with its name set in the album's own face and tinted
// with the cover's own colour, and when its photos were taken beneath. Sizes
// itself from its container (the grid and the sidebar share it), so the
// caller only picks an aspect ratio. The caption appears together with the
// cover, once its font and colour are settled, so nothing swaps in view.
export function AlbumCard({
	album,
	className,
	isActive,
	onClick,
}: {
	album: Album
	className?: string
	isActive?: boolean
	onClick: () => void
}) {
	const {t, i18n} = useTranslation()
	const style = ALBUM_STYLES[albumStyleId(album.id)]
	const fontReady = useFontReady(fontSpec(style), album.name)
	const {tone, ready: toneReady, onLoad} = useCoverTone(Boolean(album.coverId))
	const dates = formatAlbumDates(album.takenFrom, album.takenTo, i18n.language)
	const count = t('photos-collections.count', {
		count: album.count,
		formattedCount: formatNumberI18n({n: album.count, showDecimals: false, locale: i18n.language}),
	})

	return (
		<button
			type='button'
			onClick={onClick}
			aria-label={[album.name, dates, count].filter(Boolean).join(', ')}
			aria-current={isActive ? 'page' : undefined}
			className={cn(
				'group @container relative isolate block w-full overflow-hidden rounded-2xl bg-white/6 text-left shadow-lg ring-1 ring-white/10 outline-hidden ring-inset',
				'focus-visible:ring-2 focus-visible:ring-white/60',
				// Lifts a touch on hover, gives under the pointer while pressed
				'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:hover:z-10 motion-safe:hover:scale-[1.05] motion-safe:active:scale-95 motion-safe:active:duration-100',
				isActive && 'ring-white/40',
				className,
			)}
		>
			{album.coverId && (
				<ItemThumbnail
					item={{id: album.coverId}}
					loading='lazy'
					onLoad={onLoad}
					// Hover: the cover drifts in like a slow camera push (10s, steady),
					// settling at 1.3×; leaving snaps it back in a third of a second
					className='absolute inset-0 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:scale-[1.3] motion-safe:group-hover:duration-[10s] motion-safe:group-hover:ease-linear'
				/>
			)}
			{/* The scrim: the cover's own colour under the caption, as dark as legibility needs */}
			<span
				aria-hidden
				className='pointer-events-none absolute inset-x-0 bottom-0 h-[55%]'
				style={{background: tone.scrim}}
			/>
			<span
				className={cn(
					'absolute inset-x-0 bottom-0 flex flex-col px-[clamp(12px,6.5cqw,18px)] pb-[clamp(9px,4.5cqw,13px)] transition-opacity duration-300',
					fontReady && toneReady ? 'opacity-100' : 'opacity-0',
				)}
			>
				<span
					className='font-synthesis-none line-clamp-2 leading-[1.1] text-pretty transition-colors duration-300'
					style={{
						fontFamily: style.family,
						fontWeight: style.weight,
						fontStyle: style.italic ? 'italic' : undefined,
						textTransform: style.uppercase ? 'uppercase' : undefined,
						letterSpacing: style.tracking,
						fontSize: `calc(clamp(15px, 9cqw, 26px) * ${style.scale})`,
						color: tone.tint ?? 'white',
					}}
				>
					{album.name}
				</span>
				{dates && (
					<span
						className='text-[clamp(11px,5cqw,13px)] leading-tight font-medium opacity-60 transition-colors duration-300'
						style={{color: tone.tint ?? 'white'}}
					>
						{dates}
					</span>
				)}
			</span>
		</button>
	)
}
