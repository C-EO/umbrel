import {
	createContext,
	ReactNode,
	RefObject,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'
import {usePreviousDistinct} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {Wallpaper23VideoSources} from '@/components/wallpaper-23-video-sources'
import {useDocumentHidden} from '@/hooks/use-document-hidden'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'
import {tw} from '@/utils/tw'

type WallpaperBase = {
	id: string | undefined
	url: string
	brandColorHsl: string
}

export const wallpapers = [
	{
		id: '1',
		url: '/assets/wallpapers/1.jpg',
		brandColorHsl: '259 100% 59%',
	},
	{
		id: '2',
		url: '/assets/wallpapers/2.jpg',
		brandColorHsl: '6 56% 54%',
	},
	{
		id: '3',
		url: '/assets/wallpapers/3.jpg',
		brandColorHsl: '22 88% 40%',
	},
	{
		id: '4',
		url: '/assets/wallpapers/4.jpg',
		brandColorHsl: '198 100% 31%',
	},
	{
		id: '5',
		url: '/assets/wallpapers/5.jpg',
		brandColorHsl: '202 100% 33%',
	},
	{
		id: '6',
		url: '/assets/wallpapers/6.jpg',
		brandColorHsl: '160 100% 27%',
	},
	{
		id: '7',
		url: '/assets/wallpapers/7.jpg',
		brandColorHsl: '79 100% 25%',
	},
	{
		id: '8',
		url: '/assets/wallpapers/8.jpg',
		brandColorHsl: '185 100% 29%',
	},
	{
		id: '9',
		url: '/assets/wallpapers/9.jpg',
		brandColorHsl: '359 64% 62%',
	},
	{
		id: '10',
		url: '/assets/wallpapers/10.jpg',
		brandColorHsl: '18 75% 52%',
	},
	{
		id: '11',
		url: '/assets/wallpapers/11.jpg',
		brandColorHsl: '185 100% 29%',
	},
	{
		id: '12',
		url: '/assets/wallpapers/12.jpg',
		brandColorHsl: '332 84% 47%',
	},
	{
		id: '13',
		url: '/assets/wallpapers/13.jpg',
		brandColorHsl: '194 81% 39%',
	},
	{
		id: '14',
		url: '/assets/wallpapers/14.jpg',
		brandColorHsl: '328 87% 49%',
	},
	{
		id: '15',
		url: '/assets/wallpapers/15.jpg',
		brandColorHsl: '32 100% 36%',
	},
	{
		id: '16',
		url: '/assets/wallpapers/16.jpg',
		brandColorHsl: '265 100% 42%',
	},
	{
		id: '17',
		url: '/assets/wallpapers/17.jpg',
		brandColorHsl: '184 100% 25%',
	},
	{
		id: '18',
		url: '/assets/wallpapers/18.jpg',
		brandColorHsl: '259 100% 59%',
	},
	{
		id: '19',
		url: '/assets/wallpapers/19.jpg',
		brandColorHsl: '204 100% 41%',
	},
	{
		id: '20',
		url: '/assets/wallpapers/20.jpg',
		brandColorHsl: '259 100% 59%',
	},
	{
		id: '21',
		url: '/assets/wallpapers/21.jpg',
		brandColorHsl: '12 78% 50%',
	},
	{
		id: '22',
		url: '/assets/wallpapers/22.jpg',
		brandColorHsl: '92 52% 41%',
	},
	{
		id: '23',
		url: '/assets/wallpapers/23.jpg',
		brandColorHsl: '24 90% 50%',
	},
	{
		id: '24',
		url: '/assets/wallpapers/24.jpg',
		brandColorHsl: '209 85% 42%',
	},
	{
		id: '25',
		url: '/assets/wallpapers/25.jpg',
		brandColorHsl: '174 75% 32%',
	},
	{
		id: '26',
		url: '/assets/wallpapers/26.jpg',
		brandColorHsl: '14 96% 52%',
	},
] as const satisfies readonly WallpaperBase[]

export type WallpaperAvifTier = 'large' | 'medium' | 'small' | 'thumbnails'

export function getWallpaperAvifUrl(wallpaper: WallpaperBase, tier: WallpaperAvifTier) {
	return `/assets/wallpapers/generated-avif/${tier}/${wallpaper.id}.avif`
}

export function WallpaperAvifSource({wallpaper, tier}: {wallpaper: WallpaperBase; tier: WallpaperAvifTier}) {
	// While the remote wallpaper is still resolving we hold `nullWallpaper`, whose id is
	// undefined. A <source> is picked on `type` support alone — never on whether the file
	// loads — so emitting `.../undefined.avif` would commit an AVIF-capable browser to a
	// 404 with no fallback to the sibling <img>.
	if (!wallpaper.id) return null
	return <source type='image/avif' srcSet={getWallpaperAvifUrl(wallpaper, tier)} />
}

const wallpaperAvifLargeWidths: Partial<Record<string, number>> = {
	// The original artwork is 1920×1080; do not label an upscale as a 2880px source.
	'14': 1920,
}

export function getWallpaperAvifSrcSet(wallpaper: WallpaperBase) {
	const largeWidth = (wallpaper.id && wallpaperAvifLargeWidths[wallpaper.id]) || 2880
	return [
		`${getWallpaperAvifUrl(wallpaper, 'medium')} 1440w`,
		`${getWallpaperAvifUrl(wallpaper, 'large')} ${largeWidth}w`,
	].join(', ')
}

const wallpaperSizes = '100vw'

function FullWallpaperAvifSources({wallpaper}: {wallpaper: WallpaperBase}) {
	return (
		<>
			{/* object-cover scales landscape wallpapers by viewport height in portrait, so always use the largest tier there. */}
			<source media='(orientation: portrait)' type='image/avif' srcSet={getWallpaperAvifUrl(wallpaper, 'large')} />
			<source type='image/avif' srcSet={getWallpaperAvifSrcSet(wallpaper)} sizes={wallpaperSizes} />
		</>
	)
}

export type Wallpaper = (typeof wallpapers)[number]
export type WallpaperId = (typeof wallpapers)[number]['id']
export const wallpapersKeyed = keyBy(wallpapers, 'id')
export const wallpaperIds = wallpapers.map((w) => w.id)

// ---

const nullWallpaper = {
	id: undefined,
	url: '',
	brandColorHsl: '0 0% 50%',
} as const satisfies WallpaperBase

type WallpaperType = {
	wallpaper: Wallpaper | typeof nullWallpaper
	isLoading: boolean
	prevWallpaper: Wallpaper | undefined
	setWallpaperId: (id: WallpaperId) => void
	wallpaperFullyVisible: boolean
	setWallpaperFullyVisible: () => void
	setWallpaperLoaded: (url: string) => void
	setWallpaperLoadFailed: () => void
	wallpaperLoadedUrl: string | undefined
	/** The full-res wallpaper media — Glass surfaces refract from it on browsers without backdrop-filter: url() */
	wallpaperImgRef: RefObject<HTMLImageElement | HTMLVideoElement | null>
	/** A static full-size wallpaper image for surfaces that should not sample a video wallpaper. */
	staticWallpaperImgRef: RefObject<HTMLImageElement | null>
}

const WallPaperContext = createContext<WallpaperType>(null as any)

type WallpaperVideoPauseType = {
	/** Whether the desktop's wallpaper video is held still, e.g. while a sheet covers the desktop. */
	paused: boolean
	setPaused: (paused: boolean) => void
}

// Separate from WallPaperContext so toggling it re-renders only the wallpaper
// video and whoever holds it, not every useWallpaper() consumer.
const WallpaperVideoPauseContext = createContext<WallpaperVideoPauseType | null>(null)

function WallpaperVideoPauseProvider({children}: {children: ReactNode}) {
	const [paused, setPaused] = useState(false)
	return <WallpaperVideoPauseContext value={{paused, setPaused}}>{children}</WallpaperVideoPauseContext>
}

function useWallpaperVideoPause() {
	const ctx = useContext(WallpaperVideoPauseContext)
	if (!ctx) throw new Error('useWallpaperVideoPause must be used within WallpaperProvider')
	return ctx
}

/*
Scenarios:
- First load, nothing in localStorage yet
- Waiting for remote call
	* Always show either local or null wallpaper
- Remote and local are different
	* Always 
- Logged out vs. logged in
	* When logged out, use the local storage value
	* After logged in, use remote value
*/

export function WallpaperProviderConnected({children}: {children: ReactNode}) {
	const remote = useRemoteWallpaper()

	const remoteWallpaper = remote.wallpaper

	// We want to avoid showing a wallpaper and then changing it later, unless we already had one cached locally
	// since that's most likely going to be the right one. But after the remote call returns, we show the remote
	// one if it returns (usually when user is logged in), and otherwise we show either the local one.
	// The default one is loaded when nothing is in local storage yet.
	const wallpaper = remote.isLoading ? nullWallpaper : remoteWallpaper || nullWallpaper

	return (
		<WallpaperProvider wallpaper={wallpaper} onWallpaperChange={(w) => remote.setWallpaperId(w.id)}>
			{children}
		</WallpaperProvider>
	)
}

export function WallpaperProvider({
	wallpaper,
	onWallpaperChange,
	children,
}: {
	wallpaper: Wallpaper | typeof nullWallpaper
	onWallpaperChange: (wallpaper: Wallpaper) => void
	children: ReactNode
}) {
	const [isLoading, setIsLoading] = useState(true)
	const [wallpaperFullyVisible, setWallpaperFullyVisible] = useState(false)
	const [wallpaperLoadedUrl, setWallpaperLoadedUrl] = useState<string>()
	const wallpaperImgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
	const staticWallpaperImgRef = useRef<HTMLImageElement | null>(null)

	const prevId = usePreviousDistinct(wallpaper.id)

	useWallpaperCssVars(wallpaper.id)

	useLayoutEffect(() => {
		if (wallpaper.id === prevId) return
		setWallpaperFullyVisible(false)
		setIsLoading(true)
		setWallpaperLoadedUrl(undefined)
	}, [wallpaper.id, prevId])

	return (
		<WallPaperContext
			value={{
				wallpaper,
				isLoading,
				prevWallpaper: (prevId && wallpapersKeyed[prevId]) || undefined,
				setWallpaperId: (id: WallpaperId) => {
					onWallpaperChange(wallpapersKeyed[id])
				},
				wallpaperFullyVisible,
				setWallpaperFullyVisible: () => setWallpaperFullyVisible(true),
				setWallpaperLoaded: (url) => {
					setWallpaperLoadedUrl(url)
					setIsLoading(false)
				},
				setWallpaperLoadFailed: () => {
					setWallpaperLoadedUrl(undefined)
					setIsLoading(false)
					setWallpaperFullyVisible(true)
				},
				wallpaperLoadedUrl,
				wallpaperImgRef,
				staticWallpaperImgRef,
			}}
		>
			<WallpaperVideoPauseProvider>{children}</WallpaperVideoPauseProvider>
		</WallPaperContext>
	)
}

export function useWallpaperCssVars(wallpaperId?: WallpaperId) {
	const {brandColorHsl} = wallpaperId ? wallpapersKeyed[wallpaperId] : nullWallpaper

	useLayoutEffect(() => {
		const el = document.documentElement
		el.style.setProperty('--color-brand', brandColorHsl)
		el.style.setProperty('--color-brand-lighter', brandHslLighter(brandColorHsl))
		el.style.setProperty('--color-brand-lightest', brandHslLightest(brandColorHsl))
		const settingsToneLightnesses = [62, 48, 34, 20, 10, 2]
		settingsToneLightnesses.forEach((lightness, index) => {
			el.style.setProperty(`--settings-tone-${index + 1}`, brandHslWithLightness(brandColorHsl, lightness))
		})
		el.style.setProperty('--settings-tone-cold', brandHslWithLightness(brandColorHsl, 90))
		el.style.setProperty('--settings-tone-temperature-border', brandHslWithLightness(brandColorHsl, 10))
		el.style.setProperty('--settings-tone-hot', brandHslWithLightness(brandColorHsl, 10))
	}, [brandColorHsl])
}

/**
 * Get the wallpaper from the user's settings. However, we want to preserve the wallpaper after logout locally so they see it when they log in again.
 */
export const useWallpaper = () => {
	const ctx = useContext(WallPaperContext)
	if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
	return ctx
}

/**
 * Holds the desktop's wallpaper video (wallpaper 23) still while `paused` is true.
 * A sheet leaves only the wallpaper's margins visible, and decoding a video behind
 * it costs ~35% of a CPU core wherever the browser lacks a hardware decoder for
 * the chosen codec. The video resumes as soon as `paused` turns false or the
 * caller unmounts.
 */
export function usePauseWallpaperVideo(paused: boolean) {
	const {setPaused} = useWallpaperVideoPause()

	useEffect(() => {
		if (!paused) return
		setPaused(true)
		return () => setPaused(false)
	}, [paused, setPaused])
}

export function Wallpaper({
	className,
	stayBlurred,
	isPreview,
}: {
	className?: string
	stayBlurred?: boolean
	isPreview?: boolean
}) {
	const {
		wallpaper,
		prevWallpaper,
		isLoading,
		wallpaperFullyVisible,
		setWallpaperFullyVisible,
		setWallpaperLoaded,
		setWallpaperLoadFailed,
		wallpaperImgRef,
		staticWallpaperImgRef,
	} = useWallpaper()
	const {paused: videoPaused} = useWallpaperVideoPause()

	if (!wallpaper || !wallpaper.id) return null

	return (
		<>
			<picture>
				<WallpaperAvifSource wallpaper={wallpaper} tier='thumbnails' />
				<FadeInImg
					key={wallpaper.url + '-loading'}
					src={wallpaper.url}
					className={cn(
						'pointer-events-none fixed inset-0 w-full scale-125 object-cover object-center blur-[var(--wallpaper-blur)] duration-700',
						isPreview && 'absolute h-full',
						!isPreview && 'h-lvh',
						className,
					)}
				/>
			</picture>
			{!stayBlurred &&
				(wallpaper.id === '23' ? (
					<FullWallpaperVideo
						key={wallpaper.url}
						wallpaper={wallpaper}
						isLoading={isLoading}
						isPreview={isPreview}
						className={className}
						wallpaperImgRef={isPreview ? undefined : wallpaperImgRef}
						staticWallpaperImgRef={isPreview ? undefined : staticWallpaperImgRef}
						paused={!isPreview && videoPaused}
						onLoad={setWallpaperLoaded}
						onLoadFailure={setWallpaperLoadFailed}
						onAnimationEnd={setWallpaperFullyVisible}
					/>
				) : (
					<FullWallpaperImage
						key={wallpaper.url}
						wallpaper={wallpaper}
						isLoading={isLoading}
						isPreview={isPreview}
						className={className}
						wallpaperImgRef={isPreview ? undefined : wallpaperImgRef}
						staticWallpaperImgRef={isPreview ? undefined : staticWallpaperImgRef}
						onLoad={setWallpaperLoaded}
						onLoadFailure={setWallpaperLoadFailed}
						onAnimationEnd={setWallpaperFullyVisible}
					/>
				))}
			{/* Put this last so that we can see it exiting over the new wallpaper */}
			{prevWallpaper && !wallpaperFullyVisible && (
				<picture key={prevWallpaper.url}>
					<FullWallpaperAvifSources wallpaper={prevWallpaper} />
					<img
						src={prevWallpaper.url}
						alt=''
						aria-hidden='true'
						className={cn(
							'pointer-events-none fixed inset-0 size-full animate-out object-cover object-center duration-700 fill-mode-both fade-out zoom-out-125',
							isPreview && 'absolute',
							className,
						)}
					/>
				</picture>
			)}
			{/* {isLoading && <div className='fixed left-0 top-0 '>Loading...</div>} */}
		</>
	)
}

type FullWallpaperImageProps = {
	wallpaper: Wallpaper
	isLoading: boolean
	isPreview?: boolean
	className?: string
	wallpaperImgRef?: RefObject<HTMLImageElement | HTMLVideoElement | null>
	staticWallpaperImgRef?: RefObject<HTMLImageElement | null>
	onLoad: (url: string) => void
	onLoadFailure: () => void
	onAnimationEnd: () => void
}

function FullWallpaperImage({
	wallpaper,
	isLoading,
	isPreview,
	className,
	wallpaperImgRef,
	staticWallpaperImgRef,
	onLoad,
	onLoadFailure,
	onAnimationEnd,
}: FullWallpaperImageProps) {
	const [loadAttempt, setLoadAttempt] = useState<'responsive' | 'jpeg' | 'failed'>('responsive')
	const setImageRef = useCallback(
		(image: HTMLImageElement | null) => {
			if (wallpaperImgRef) wallpaperImgRef.current = image
			if (staticWallpaperImgRef) staticWallpaperImgRef.current = image
		},
		[staticWallpaperImgRef, wallpaperImgRef],
	)

	if (loadAttempt === 'failed') return null

	return (
		<picture>
			{loadAttempt === 'responsive' && <FullWallpaperAvifSources wallpaper={wallpaper} />}
			<FadeInImg
				key={loadAttempt}
				ref={setImageRef}
				src={wallpaper.url}
				data-wallpaper-full=''
				className={cn(
					// Using black bg by default because sometimes we want to show the wallpaper before it's loaded, and over other elements
					tw`pointer-events-none fixed inset-0 w-full animate-in bg-black object-cover object-center duration-700 fade-in`,
					isPreview && 'absolute h-full',
					!isPreview && 'h-lvh',
					className,
				)}
				style={{
					// Mount immediately so the browser can fetch its chosen candidate, then reveal only after it loads.
					animation: isLoading ? 'none' : 'animate-unblur 0.7s',
				}}
				onLoad={(event) => onLoad(event.currentTarget.currentSrc)}
				onError={() => {
					if (loadAttempt === 'responsive') {
						setLoadAttempt('jpeg')
						return
					}
					setLoadAttempt('failed')
					onLoadFailure()
				}}
				onAnimationEnd={onAnimationEnd}
			/>
		</picture>
	)
}

// Lets the sheet's 200ms enter animation land before the wallpaper's motion stops.
const VIDEO_PAUSE_DELAY_MS = 250

function FullWallpaperVideo(props: FullWallpaperImageProps & {paused: boolean}) {
	const {
		wallpaper,
		isLoading,
		isPreview,
		className,
		wallpaperImgRef,
		staticWallpaperImgRef,
		paused,
		onLoad,
		onAnimationEnd,
	} = props
	const loadNotifiedRef = useRef(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const setVideoRef = useCallback(
		(video: HTMLVideoElement | null) => {
			videoRef.current = video
			if (wallpaperImgRef) wallpaperImgRef.current = video
		},
		[wallpaperImgRef],
	)

	// Nothing sees the video while a sheet covers the desktop or the tab is in the
	// background, so stop decoding it. Resuming is immediate: the frames are buffered.
	const documentHidden = useDocumentHidden()
	const shouldPause = paused || documentHidden
	useEffect(() => {
		const video = videoRef.current
		if (!video) return
		if (!shouldPause) {
			// Rejects when a pause() lands before playback starts; nothing to handle
			if (video.paused) video.play().catch(() => {})
			return
		}
		const timeout = setTimeout(() => {
			// A video that hasn't shown a frame yet is left to `handlePlaying`:
			// pausing it now would cancel autoplay and strand the loaded signal
			if (loadNotifiedRef.current) video.pause()
		}, VIDEO_PAUSE_DELAY_MS)
		return () => clearTimeout(timeout)
	}, [shouldPause])
	const handlePlaying = useCallback(() => {
		if (!loadNotifiedRef.current) {
			loadNotifiedRef.current = true
			onLoad(wallpaper.url)
		}
		// Covers a first frame that arrived after the timer above, and playback the
		// browser resumed on its own (e.g. iOS returning to the foreground)
		if (shouldPause) videoRef.current?.pause()
	}, [onLoad, shouldPause, wallpaper.url])
	const setStaticImageRef = useCallback(
		(image: HTMLImageElement | null) => {
			if (staticWallpaperImgRef) staticWallpaperImgRef.current = image
		},
		[staticWallpaperImgRef],
	)

	return (
		<>
			{staticWallpaperImgRef && (
				<img
					ref={setStaticImageRef}
					src={wallpaper.url}
					alt=''
					aria-hidden='true'
					data-wallpaper-static-source=''
					className={cn(
						'pointer-events-none fixed inset-0 w-full object-cover object-center opacity-0',
						isPreview && 'absolute h-full',
						!isPreview && 'h-lvh',
						className,
					)}
				/>
			)}
			<video
				ref={setVideoRef}
				autoPlay
				loop
				muted
				playsInline
				disablePictureInPicture
				preload='auto'
				poster={wallpaper.url}
				aria-hidden='true'
				data-wallpaper-full=''
				className={cn(
					tw`pointer-events-none fixed inset-0 w-full animate-in bg-black object-cover object-center opacity-100 transition-opacity duration-700 fade-in`,
					isPreview && 'absolute h-full',
					!isPreview && 'h-lvh',
					className,
				)}
				style={{
					animation: isLoading ? 'none' : 'animate-unblur 0.7s',
				}}
				onPlaying={handlePlaying}
				onAnimationEnd={onAnimationEnd}
			>
				<Wallpaper23VideoSources />
			</video>
		</>
	)
}

function useRemoteWallpaper(onSuccess?: (id: WallpaperId) => void) {
	// Refetching causes lots of failed calls to the backend on bare pages before we're logged in.
	const userQ = trpcReact.user.wallpaper.useQuery(undefined, {
		retry: false,
	})
	const wallpaperQId = userQ.data

	// Handle the onSuccess side effect
	useEffect(() => {
		if (userQ.isSuccess && wallpaperQId && arrayIncludes(wallpaperIds, wallpaperQId)) {
			onSuccess?.(wallpaperQId)
		}
	}, [userQ.isSuccess, wallpaperQId, onSuccess])

	const utils = trpcReact.useUtils()
	const userMut = trpcReact.user.set.useMutation({
		onSuccess: () => {
			utils.user.get.invalidate()
			utils.user.wallpaper.invalidate()
		},
	})
	const setWallpaperId = useCallback((id: WallpaperId) => userMut.mutate({wallpaper: id}), [userMut])

	return {
		isLoading: userQ.isLoading,
		wallpaper: wallpaperQId && arrayIncludes(wallpaperIds, wallpaperQId) ? wallpapersKeyed[wallpaperQId] : undefined,
		setWallpaperId,
	}
}

/**
 * Updates local storage with the wallpaper id from the backend.
 *
 * There's a little dance that needs to happen with wallpapers. When we first load the page, we don't have the TRPC context yet, and we determine the wallpaper from
 * local storage. Usually, this id will be correct. However, if the user changed the wallpaper on another browser,
 * the local storage value will be out of date. So we load the old wallpaper and wait until the TRPC context is available to load the correct one.
 */
export function RemoteWallpaperInjector() {
	const remote = useRemoteWallpaper()
	const {wallpaper, setWallpaperId} = useWallpaper()

	const localId = wallpaper?.id
	const remoteId = remote.wallpaper?.id

	// Chance of circular dependency here, so it's important to ensure that the dependencies do not invalidate unless absolutely necessary.
	useEffect(() => {
		if (remoteId && remoteId !== localId) setWallpaperId(remoteId)
	}, [remoteId, localId, setWallpaperId])

	return null
}

export const LIGHTEN_AMOUNT = 8
function brandHslWithLightness(hsl: string, lightness: number) {
	const [h, saturation] = hsl.split(' ')
	return `${h} ${saturation} ${lightness}%`
}

function brandHslLighterByAmount(hsl: string, amount: number) {
	const tokens = hsl.split(' ')
	const h = tokens[0]
	const s = parseFloat(tokens[1])
	const l = parseFloat(tokens[2].replace('%', ''))
	const lLighter = l > 100 ? 100 : l + amount
	return `${h} ${s}% ${lLighter}%`
}

export function brandHslLighter(hsl: string) {
	return brandHslLighterByAmount(hsl, LIGHTEN_AMOUNT)
}
export function brandHslLightest(hsl: string) {
	return brandHslLighterByAmount(hsl, LIGHTEN_AMOUNT * 2)
}
