import useEmblaCarousel, {type UseEmblaCarouselType} from 'embla-carousel-react'
import {ArrowLeft, ArrowRight} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import * as React from 'react'
import {TbChevronLeft, TbChevronRight} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
	opts?: CarouselOptions
	plugins?: CarouselPlugin
	orientation?: 'horizontal' | 'vertical'
	setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
	carouselRef: ReturnType<typeof useEmblaCarousel>[0]
	api: ReturnType<typeof useEmblaCarousel>[1]
	scrollPrev: () => void
	scrollNext: () => void
	canScrollPrev: boolean
	canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
	const context = React.useContext(CarouselContext)

	if (!context) {
		throw new Error('useCarousel must be used within a <Carousel />')
	}

	return context
}

function Carousel({
	orientation = 'horizontal',
	opts,
	setApi,
	plugins,
	className,
	children,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & CarouselProps & {ref?: React.Ref<HTMLDivElement>}) {
	const [carouselRef, api] = useEmblaCarousel(
		{
			...opts,
			axis: orientation === 'horizontal' ? 'x' : 'y',
		},
		plugins,
	)
	const [canScrollPrev, setCanScrollPrev] = React.useState(false)
	const [canScrollNext, setCanScrollNext] = React.useState(false)

	const onSelect = React.useCallback((api: CarouselApi) => {
		if (!api) {
			return
		}

		setCanScrollPrev(api.canScrollPrev())
		setCanScrollNext(api.canScrollNext())
	}, [])

	const scrollPrev = React.useCallback(() => {
		api?.scrollPrev()
	}, [api])

	const scrollNext = React.useCallback(() => {
		api?.scrollNext()
	}, [api])

	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === 'ArrowLeft') {
				event.preventDefault()
				scrollPrev()
			} else if (event.key === 'ArrowRight') {
				event.preventDefault()
				scrollNext()
			}
		},
		[scrollPrev, scrollNext],
	)

	React.useEffect(() => {
		if (!api || !setApi) {
			return
		}

		setApi(api)
	}, [api, setApi])

	React.useEffect(() => {
		if (!api) {
			return
		}

		onSelect(api)
		api.on('reInit', onSelect)
		api.on('select', onSelect)

		return () => {
			api?.off('select', onSelect)
		}
	}, [api, onSelect])

	return (
		<CarouselContext
			value={{
				carouselRef,
				api: api,
				opts,
				orientation: orientation || (opts?.axis === 'y' ? 'vertical' : 'horizontal'),
				scrollPrev,
				scrollNext,
				canScrollPrev,
				canScrollNext,
			}}
		>
			<div
				ref={ref}
				onKeyDownCapture={handleKeyDown}
				className={cn('relative', className)}
				role='region'
				aria-roledescription='carousel'
				{...props}
			>
				{children}
			</div>
		</CarouselContext>
	)
}

function CarouselContent({
	className,
	containerClassName,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {
	/** Extra classes for the overflow-clipping viewport (e.g. inner padding so
	 * slides align to the content grid while bleeding to the sheet edges) */
	containerClassName?: string
	ref?: React.Ref<HTMLDivElement>
}) {
	const {carouselRef, orientation} = useCarousel()

	return (
		<div ref={carouselRef} className={cn('overflow-hidden', containerClassName)}>
			<div
				ref={ref}
				className={cn('flex', orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col', className)}
				{...props}
			/>
		</div>
	)
}

function CarouselItem({
	className,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {ref?: React.Ref<HTMLDivElement>}) {
	const {orientation} = useCarousel()

	return (
		<div
			ref={ref}
			role='group'
			aria-roledescription='slide'
			className={cn('min-w-0 shrink-0 grow-0 basis-full', orientation === 'horizontal' ? 'pl-4' : 'pt-4', className)}
			{...props}
		/>
	)
}

function CarouselPrevious({
	className,
	ref,
	variant = 'default',
	size = 'icon-only',
	...props
}: React.ComponentProps<typeof Button> & {ref?: React.Ref<HTMLButtonElement>}) {
	const {orientation, scrollPrev, canScrollPrev} = useCarousel()

	return (
		<Button
			ref={ref}
			variant={variant}
			size={size}
			className={cn(
				'absolute h-8 w-8 rounded-full',
				orientation === 'horizontal'
					? 'top-1/2 -left-12 -translate-y-1/2'
					: '-top-12 left-1/2 -translate-x-1/2 rotate-90',
				className,
			)}
			disabled={!canScrollPrev}
			onClick={scrollPrev}
			{...props}
		>
			<ArrowLeft className='h-4 w-4' />
			<span className='sr-only'>Previous slide</span>
		</Button>
	)
}

function CarouselNext({
	className,
	ref,
	variant = 'default',
	size = 'icon-only',
	...props
}: React.ComponentProps<typeof Button> & {ref?: React.Ref<HTMLButtonElement>}) {
	const {orientation, scrollNext, canScrollNext} = useCarousel()

	return (
		<Button
			ref={ref}
			variant={variant}
			size={size}
			className={cn(
				'absolute h-8 w-8 rounded-full',
				orientation === 'horizontal'
					? 'top-1/2 -right-12 -translate-y-1/2'
					: '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
				className,
			)}
			disabled={!canScrollNext}
			onClick={scrollNext}
			{...props}
		>
			<ArrowRight className='h-4 w-4' />
			<span className='sr-only'>Next slide</span>
		</Button>
	)
}

/** The carousel's snap positions and which one is active, kept in sync with the api */
function useCarouselSnaps(api: CarouselApi) {
	const [snapCount, setSnapCount] = React.useState(0)
	const [activeIndex, setActiveIndex] = React.useState(0)
	const [canScrollPrev, setCanScrollPrev] = React.useState(false)
	const [canScrollNext, setCanScrollNext] = React.useState(false)

	React.useEffect(() => {
		if (!api) return
		const update = () => {
			setSnapCount(api.scrollSnapList().length)
			setActiveIndex(api.selectedScrollSnap())
			setCanScrollPrev(api.canScrollPrev())
			setCanScrollNext(api.canScrollNext())
		}
		update()
		api.on('select', update)
		api.on('reInit', update)
		return () => {
			api.off('select', update)
			api.off('reInit', update)
		}
	}, [api])

	return {snapCount, activeIndex, canScrollPrev, canScrollNext}
}

/**
 * Advances the carousel on a timer and reports the countdown as 0–100 for the
 * active dot's fill. The countdown holds while the user is dragging, hovering,
 * focusing carousel content, or while the tab is hidden. It restarts whenever
 * the slide changes and is disabled entirely under reduced motion.
 */
function useCarouselAutoAdvance(api: CarouselApi, {intervalMs = 5000, enabled = true, paused = false} = {}) {
	const reducedMotion = useReducedMotion()
	const [progress, setProgress] = React.useState(0)
	const run = enabled && !reducedMotion

	React.useEffect(() => {
		if (!api || !run || paused) return

		let elapsed = 0
		let last = performance.now()
		let held = false
		setProgress(0)

		const onPointerDown = () => (held = true)
		const onPointerUp = () => (held = false)
		const onSelect = () => {
			elapsed = 0
			setProgress(0)
		}

		// 10Hz is plenty: the dot's fill transition smooths between updates
		const timer = window.setInterval(() => {
			const now = performance.now()
			const delta = now - last
			last = now
			if (held || document.hidden) return
			elapsed += delta
			if (elapsed >= intervalMs) {
				elapsed = 0
				if (api.canScrollNext()) api.scrollNext()
				else api.scrollTo(0)
			}
			setProgress(Math.min(100, (elapsed / intervalMs) * 100))
		}, 100)

		api.on('pointerDown', onPointerDown)
		api.on('pointerUp', onPointerUp)
		api.on('select', onSelect)
		return () => {
			window.clearInterval(timer)
			api.off('pointerDown', onPointerDown)
			api.off('pointerUp', onPointerUp)
			api.off('select', onSelect)
		}
	}, [api, run, intervalMs, paused])

	return run ? progress : undefined
}

/**
 * Pill dot indicators: the active dot stretches into a pill and, when a
 * progress value is provided (auto-advance countdown, video position…), fills
 * up left to right; without one it renders solid.
 */
function CarouselDots({
	count,
	activeIndex,
	onSelect,
	progress,
	className,
}: {
	count: number
	activeIndex: number
	onSelect: (index: number) => void
	/** 0–100 fill of the active dot; omit for a solid active dot */
	progress?: number
	className?: string
}) {
	if (count <= 1) return null

	return (
		<div className={cn('flex items-center justify-center gap-1', className)}>
			{Array.from({length: count}).map((_, index) => {
				const isActive = index === activeIndex

				return (
					<button
						key={index}
						onClick={() => onSelect(index)}
						className='group rounded-full p-1 outline-hidden transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/40 motion-reduce:transition-none'
						aria-label={`Go to slide ${index + 1}`}
						aria-current={isActive ? 'true' : undefined}
					>
						<div
							className={cn(
								'relative h-1.5 overflow-hidden rounded-full transition-all duration-300 motion-reduce:transition-none',
								isActive ? 'w-10 bg-white/40 group-hover:bg-white/60' : 'w-1.5 bg-white/40 group-hover:bg-white/60',
							)}
						>
							{isActive && (
								<div
									className='absolute inset-y-0 left-0 rounded-full bg-white transition-all duration-300 ease-linear motion-reduce:transition-none'
									style={{width: `${progress ?? 100}%`}}
								/>
							)}
						</div>
					</button>
				)
			})}
		</div>
	)
}

const carouselArrowClass =
	'flex h-9 w-9 items-center justify-center rounded-full bg-white/10 outline-hidden transition-colors hover:bg-white/16 focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40 disabled:hover:bg-white/10'

/** Round previous/next buttons for a carousel's control row (the
 * apps.umbrel.com banner treatment), sitting opposite the dots */
function CarouselArrows({
	onPrev,
	onNext,
	disablePrev = false,
	disableNext = false,
	className,
}: {
	onPrev: () => void
	onNext: () => void
	disablePrev?: boolean
	disableNext?: boolean
	className?: string
}) {
	return (
		<div className={cn('flex items-center gap-2', className)}>
			{/* Chevrons, matching the spotlight banners' View pill */}
			<button aria-label='Previous slide' onClick={onPrev} disabled={disablePrev} className={carouselArrowClass}>
				<TbChevronLeft className='h-4 w-4' />
			</button>
			<button aria-label='Next slide' onClick={onNext} disabled={disableNext} className={carouselArrowClass}>
				<TbChevronRight className='h-4 w-4' />
			</button>
		</div>
	)
}

export {
	type CarouselApi,
	Carousel,
	CarouselArrows,
	CarouselContent,
	CarouselDots,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
	useCarouselAutoAdvance,
	useCarouselSnaps,
}
