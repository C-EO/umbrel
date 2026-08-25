import {useEffect, useRef} from 'react'

import {cn} from '@/lib/utils'
import {useWallpaper, WallpaperAvifSource, wallpapers, type Wallpaper} from '@/providers/wallpaper'

const ITEM_W = 40
const GAP = 4
const ACTIVE_SCALE = 1.4

function WallpaperItem({
	active,
	wallpaper,
	onSelect,
	className,
	ref,
}: {
	active?: boolean
	wallpaper: Wallpaper
	onSelect: () => void
	className?: string
	ref?: React.Ref<HTMLButtonElement>
}) {
	return (
		<button
			type='button'
			ref={ref}
			onClick={onSelect}
			aria-label={`Wallpaper ${wallpaper.id}`}
			aria-pressed={active}
			className={cn(
				'relative h-6 shrink-0 overflow-hidden bg-white/10 outline-hidden transition-all duration-200 hover:brightness-125 focus-visible:ring-1 focus-visible:ring-brand',
				active
					? // NOTE: `mx-3` or whatever horizontal marging needs to be big enough to not cause the ring to get clipped from scrolling container
						'mx-3 rounded-5 shadow-[0_0_14px_hsl(var(--color-brand)/0.72)] ring-2 ring-brand'
					: 'rounded-3',
				className,
			)}
			style={{
				width: ITEM_W,
				transform: `scale(${active ? ACTIVE_SCALE : 1})`,
				// transformOrigin: "left center",
			}}
		>
			<picture>
				<WallpaperAvifSource wallpaper={wallpaper} tier='thumbnails' />
				<img
					src={wallpaper.url}
					alt=''
					aria-hidden='true'
					className='pointer-events-none absolute inset-0 size-full object-cover object-center'
				/>
			</picture>
		</button>
	)
}

// TODO: delay mounting for performance
export function WallpaperPicker({maxW}: {maxW?: number}) {
	const {wallpaper, setWallpaperId} = useWallpaper()
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollerRef = useRef<HTMLDivElement>(null)
	const itemsRef = useRef<HTMLDivElement>(null)
	const selectedItemRef = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (!containerRef.current || !selectedItemRef.current || !itemsRef.current || !scrollerRef.current) {
			return
		}

		const containerW = containerRef.current.clientWidth
		const index = wallpapers.findIndex((w) => w.id === wallpaper.id)

		scrollerRef.current.scrollTo({
			behavior: 'smooth',
			left: index * (ITEM_W + GAP) - containerW / 2 + (ITEM_W * ACTIVE_SCALE) / 2,
		})
	}, [wallpaper.id])

	return (
		// h-7 so we don't affect height of parent, but make gap work when wrapping
		<div ref={containerRef} className='flex h-7 max-w-full flex-grow-1 animate-in items-center fade-in'>
			<div
				className={cn(
					'umbrel-hide-scrollbar umbrel-wallpaper-fade-scroller w-full items-center overflow-x-auto bg-red-500/0 py-5',
					!maxW && 'md:max-w-[350px]',
				)}
				ref={scrollerRef}
				style={{
					maxWidth: maxW,
				}}
			>
				{/* NOTE: doing `items-center` here would cause the spacer items collapse because of a flex bug */}
				<div ref={itemsRef} className='flex' style={{gap: GAP}}>
					<div className='w-1 shrink-0' />
					{wallpapers.map((w) => (
						<WallpaperItem
							ref={w.id === wallpaper.id ? selectedItemRef : undefined}
							key={w.id}
							active={w.id === wallpaper.id}
							onSelect={() => {
								setWallpaperId(w.id)
							}}
							wallpaper={w}
						/>
					))}
					<div className='w-1 shrink-0' />
				</div>
			</div>
		</div>
	)
}
