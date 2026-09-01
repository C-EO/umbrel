import {AnimatePresence, motion} from 'motion/react'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoLogoAndroid, IoLogoApple} from 'react-icons/io5'
import {RiCloseLine} from 'react-icons/ri'

import {AppIcon} from '@/components/app-icon'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {DarkTooltip, darkTooltipClass} from '@/components/ui/dark-tooltip'
import {useStorefront} from '@/features/app-store/hooks/use-storefront'
import {
	AiThumbnail,
	AudioThumbnail,
	CsvThumbnail,
	DmgThumbnail,
	DocxThumbnail,
	EbookThumbnail,
	ExeThumbnail,
	ImageThumbnail,
	IsoThumbnail,
	PdfThumbnail,
	PptThumbnail,
	PsdThumbnail,
	TxtThumbnail,
	VideoThumbnail,
} from '@/features/files/assets/file-items-thumbnails'
import {ONBOARDING_COMPLETE_NOTIFICATION, useClearNotification} from '@/hooks/use-notifications'
import {useWidgets} from '@/hooks/use-widgets'
import {cn} from '@/lib/utils'
import {systemAppsKeyed} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {trpcReact, type RegistryApp} from '@/trpc/trpc'
import {focusRingOnWallpaperClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

import {AppGrid} from './app-grid/app-grid'
import {desktopVariants, desktopWidgetNode, useDesktopVariant} from './desktop-content'
import {DockSpacer} from './dock'
import {Header} from './header'

const PHOTOS_ICON = '/assets/dock/dock-photos.webp'
const PHONE_BACKUP_SHOT = '/assets/photos/phone-backup.webp'

// Desktop for a fresh install with no apps yet: the usual greeting and the
// account's widgets, with a bento of starting points where the app grid would
// be. This is the first thing a user sees after onboarding.
//
// Bento: Files runs wide across the top, Photos stands tall down the right,
// and App Store (a touch wider) with Tailscale fill in beneath Files. Each
// card leads with its feature icon and carries a small living illustration
// in a pool of its accent light.
export function WelcomeDesktop() {
	const {t} = useTranslation()
	const userQ = trpcReact.user.get.useQuery()
	const name = userQ.data?.name
	// Members can't install apps: the App Store card runs wide with copy about
	// requesting apps from the owner, and the Tailscale card is dropped
	const isMember = userQ.data?.role === 'member'
	const {appsKeyed} = useAvailableApps()
	// The real selection (the defaults until changed), so the row carries over
	// unchanged when the welcome gives way to the desktop
	const widgets = useWidgets()
	// Dismissing clears the notification that gates this desktop. The bento
	// animates out first and the clear (optimistic, so the swap to the real
	// desktop is immediate) happens once it's gone, not before.
	const clearNotification = useClearNotification()
	const [dismissed, setDismissed] = useState(false)
	const deckCards = useDeckCards(appsKeyed)
	// Fades away under sheets and the widget editor like the real desktop; the
	// living illustrations pause while nothing can see them
	const variant = useDesktopVariant()
	const hidden = variant !== 'default'

	if (!name || widgets.isLoading) return null

	const tailscaleIcon = appsKeyed?.['tailscale']?.icon

	return (
		<motion.div
			className='relative z-10 flex min-h-[100dvh] w-full flex-col items-center'
			variants={desktopVariants}
			animate={variant}
			initial={{opacity: 0}}
			transition={{duration: 0.3, ease: 'easeOut'}}
		>
			<div className='pt-6 md:pt-8' />
			<Header userName={name} />
			<div className='pt-6 md:pt-8' />
			{/* Widgets paged by the same grid as the real desktop. Fixed height:
			    one widget row plus the page inset and paginator margins, from the vars the pager injects */}
			<div className='flex h-[calc(var(--widget-labeled-h,176px)+66px)] w-full overflow-hidden'>
				<AppGrid widgets={widgets.selected.map(desktopWidgetNode)} />
			</div>
			<AnimatePresence initial={false} onExitComplete={() => clearNotification(ONBOARDING_COMPLETE_NOTIFICATION)}>
				{/* The bento fills whatever space is left between the widgets and the dock */}
				{!dismissed && (
					<motion.div
						key='cards'
						exit={{opacity: 0, y: 24, scale: 0.98, transition: {duration: 0.3, ease: 'easeIn'}}}
						className='-mt-4 flex w-full flex-1 flex-col items-center gap-3 px-5 pb-5 md:pb-6'
					>
						{/* Rows are content-sized but split any spare height equally, so
					    the bento stretches on tall displays and scrolls on short ones */}
						<div className='grid w-full max-w-[1000px] flex-1 grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]'>
							<BentoCard
								index={0}
								onDismiss={() => setDismissed(true)}
								variant='wide'
								action={
									<>
										<ButtonLink to='/files' className={cardButtonClass}>
											{t('desktop.welcome.files.button')}
										</ButtonLink>
										{/* File sharing is available to the owner and members with SMB access */}
										{(!isMember || userQ.data?.sambaEnabled === true) && (
											<ButtonLink to='/settings/file-sharing' className={cardButtonClass}>
												{t('desktop.welcome.files.sharing-button')}
											</ButtonLink>
										)}
									</>
								}
								icon={systemAppsKeyed['UMBREL_files'].icon}
								title={t('desktop.welcome.files.title')}
								description={
									isMember ? t('desktop.welcome.files.member-description') : t('desktop.welcome.files.description')
								}
								accent='#4d94ff'
								glow={false}
								stage={<FilesMarquee paused={hidden} />}
								className='md:col-span-2'
							/>
							<BentoCard
								index={1}
								onDismiss={() => setDismissed(true)}
								variant='tall'
								action={
									<>
										<Button asChild variant='primary' className={cardButtonClass}>
											<a href='https://link.umbrel.com/ios-app' target='_blank' rel='noopener noreferrer'>
												<IoLogoApple className='size-3.5' />
												{t('desktop.welcome.photos.ios')}
											</a>
										</Button>
										{/* Android app isn't out yet */}
										<Button disabled className={cardButtonClass}>
											<IoLogoAndroid className='size-3.5' />
											{t('desktop.welcome.photos.android')}
										</Button>
									</>
								}
								icon={PHOTOS_ICON}
								title={t('desktop.welcome.photos.title')}
								description={t('desktop.welcome.photos.description')}
								accent='#fb7185'
								stage={<PhoneShot />}
								className='md:col-start-2 md:row-span-2 lg:col-start-auto'
							/>
							<BentoCard
								index={2}
								onDismiss={() => setDismissed(true)}
								variant={isMember ? 'wide' : 'small'}
								action={
									<ButtonLink to='/app-store' className={cardButtonClass}>
										{t('desktop.welcome.app-store.button')}
									</ButtonLink>
								}
								icon={systemAppsKeyed['UMBREL_app-store'].icon}
								title={isMember ? t('desktop.welcome.app-store.member-title') : t('desktop.welcome.app-store.title')}
								description={
									isMember
										? t('desktop.welcome.app-store.member-description')
										: t('desktop.welcome.app-store.description')
								}
								accent='#a78bfa'
								ornament={<AppDeck cards={deckCards} paused={hidden} />}
								className={isMember ? 'md:col-span-2' : undefined}
							/>
							{!isMember && (
								<>
									<BentoCard
										index={3}
										onDismiss={() => setDismissed(true)}
										action={
											<ButtonLink to='/app-store/tailscale' className={cardButtonClass}>
												{t('desktop.welcome.tailscale.button')}
											</ButtonLink>
										}
										icon={tailscaleIcon}
										iconBordered
										title={t('desktop.welcome.tailscale.title')}
										description={t('desktop.welcome.tailscale.description')}
										accent='#34d399'
									/>
								</>
							)}
						</div>
						{/* Same pill as the desktop's search button */}
						<button
							type='button'
							onClick={() => setDismissed(true)}
							className={cn(
								darkTooltipClass,
								'shrink-0 animate-in px-4 py-3.5 leading-inter-trimmed transition-colors duration-700 fill-mode-both fade-in hover:bg-white/10 active:bg-white/5 motion-reduce:animate-none',
								focusRingOnWallpaperClass,
							)}
							style={{animationDelay: '600ms'}}
						>
							{t('desktop.welcome.dismiss')}
						</button>
					</motion.div>
				)}
			</AnimatePresence>
			<DockSpacer />
		</motion.div>
	)
}

type BentoVariant = 'wide' | 'tall' | 'small'

function BentoCard({
	index,
	action,
	variant = 'small',
	icon,
	iconBordered,
	title,
	description,
	accent,
	stage,
	glow = true,
	ornament,
	className,
	onDismiss,
}: {
	/** Position in the grid, used to stagger the entrance */
	index: number
	/** Close button top right; any card's close dismisses the whole bento */
	onDismiss: () => void
	/** Buttons rendered under the description */
	action: ReactNode
	/** Wide cards place the stage beside the text; tall cards run the stage below it */
	variant?: BentoVariant
	/** The feature's own icon, leading the text block */
	icon?: string
	/** Third-party icons get the standard hairline; system icons are drawn without one */
	iconBordered?: boolean
	title: ReactNode
	description: ReactNode
	/** Signature color for the stage light */
	accent: string
	/** Illustration for wide and tall cards; small cards lead with their icon alone */
	stage?: ReactNode
	/** Accent light behind the stage; off for illustrations that carry their own color */
	glow?: boolean
	/** Decoration positioned absolutely within the card, clipped by its edges */
	ornament?: ReactNode
	className?: string
}) {
	const {t} = useTranslation()
	const text = (
		<div className={cn('my-auto', variant === 'wide' && 'md:flex-1', variant === 'tall' && 'shrink-0')}>
			{iconBordered ? (
				<AppIcon src={icon} size={56} className='rounded-12' />
			) : (
				<img src={icon} alt='' draggable={false} className='size-14 rounded-12' />
			)}
			<h3 className='mt-2.5 text-16 font-semibold -tracking-2 md:text-17'>{title}</h3>
			<p className='mt-1 max-w-[44ch] text-13 leading-snug text-white/60'>{description}</p>
			<div className='mt-3 flex flex-wrap gap-2'>{action}</div>
		</div>
	)

	// The stage: accent light pooling behind the hero
	const stageEl = !stage ? null : (
		<div
			className={cn(
				'relative grid flex-1 place-items-center py-1',
				// Wide and tall stages bleed through the card padding, edge to edge
				variant === 'wide' &&
					'hidden md:-my-6 md:-mr-6 md:grid md:w-[260px] md:flex-none md:self-stretch md:overflow-hidden md:py-0 lg:w-[320px]',
				variant === 'tall' && '-mx-5 -mb-5 min-h-[220px] overflow-hidden py-0 md:-mx-6 md:-mb-6',
			)}
		>
			{glow && (
				<div
					aria-hidden
					className={cn(
						'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 transition-opacity duration-700 group-hover:opacity-100',
						variant === 'tall' ? 'top-2/3 size-64' : 'size-44',
					)}
					style={{
						background:
							'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 40%, transparent), transparent)',
					}}
				/>
			)}
			{stage}
		</div>
	)

	const inner = (
		<>
			{ornament}
			<DarkTooltip label={t('desktop.welcome.dismiss-tips')}>
				<button
					type='button'
					onClick={onDismiss}
					aria-label={t('desktop.welcome.dismiss-tips')}
					className={cn(
						'absolute top-2 right-2 z-20 grid size-7 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white active:bg-white/5',
						focusRingOnWallpaperClass,
					)}
				>
					<RiCloseLine className='size-4' />
				</button>
			</DarkTooltip>
			<div
				className={cn(
					'relative z-10 flex h-full flex-col gap-4',
					variant === 'wide' && 'md:flex-row-reverse md:items-center md:gap-6',
					variant === 'tall' && 'gap-5',
				)}
			>
				{variant === 'tall' ? (
					<>
						{text}
						{stageEl}
					</>
				) : (
					<>
						{stageEl}
						{text}
					</>
				)}
			</div>
		</>
	)
	const style = {animationDelay: `${200 + index * 80}ms`, '--accent': accent} as React.CSSProperties

	return (
		<div className={cn(bentoCardClass, className)} style={style}>
			{inner}
		</div>
	)
}

const bentoCardClass = tw`umbrel-material group relative block h-full animate-in overflow-hidden rounded-24 p-5 duration-700 fade-in fill-mode-both slide-in-from-bottom-4 motion-reduce:animate-none md:p-6`

const cardButtonClass = tw`h-8 gap-1.5 px-3.5 text-12`

// Real file icons drifting upward in three offset columns, each looping
// seamlessly — files on their way home. The mask fades them in and out at
// the edges; every column runs at its own speed.
const marqueeColumns = [
	{
		items: [PdfThumbnail, ImageThumbnail, DocxThumbnail, AudioThumbnail],
		duration: '22s',
		offset: 'mt-10',
	},
	{items: [VideoThumbnail, TxtThumbnail, PsdThumbnail, CsvThumbnail, EbookThumbnail], duration: '17s', offset: 'mt-0'},
	{items: [PptThumbnail, IsoThumbnail, AiThumbnail, DmgThumbnail, ExeThumbnail], duration: '26s', offset: 'mt-16'},
] as const

function FilesMarquee({paused}: {paused: boolean}) {
	return (
		<div
			className='absolute inset-0 flex items-start justify-center gap-5 overflow-hidden'
			style={{maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)'}}
		>
			{marqueeColumns.map(({items, duration, offset}, column) => (
				<div
					key={column}
					className={cn('welcome-marquee flex flex-col', offset)}
					// Inline: the unlayered .welcome-marquee rule would beat a layered utility
					style={
						{'--marquee-duration': duration, animationPlayState: paused ? 'paused' : undefined} as React.CSSProperties
					}
				>
					{/* Rendered twice so the loop point is invisible */}
					{[...items, ...items].map((Thumbnail, i) => (
						<Thumbnail key={i} className='mb-5 size-16 shrink-0 drop-shadow-lg' draggable={false} />
					))}
				</div>
			))}
		</div>
	)
}

// The most-installed apps as a small deck of cards in the corner: every few
// seconds the front card is flicked over the pile and lands at the back,
// cycling through the whole set. The list comes from the storefront feed's
// "most installs" section when it's available, and falls back to this set.
const DECK_STOREFRONT_SECTION = 'most-installs'
const fallbackDeckApps = [
	'nextcloud',
	'jellyfin',
	'bitcoin',
	'openclaw',
	'ollama',
	'plex',
	'transmission',
	'home-assistant',
	'immich',
	'hermes-agent',
	'pi-hole',
	'open-webui',
] as const

const DECK_VISIBLE = 4
const DECK_INTERVAL_MS = 2800

// Poses by depth: a straight stack receding upward, each card behind a step
// higher, smaller and a touch dimmer, like cards seen from the front.
// Anything deeper than the visible stack rests at the back pose.
const deckPoses = [
	{y: 0, scale: 1, filter: 'brightness(1)'},
	{y: -12, scale: 0.9, filter: 'brightness(0.82)'},
	{y: -22, scale: 0.8, filter: 'brightness(0.66)'},
	{y: -30, scale: 0.7, filter: 'brightness(0.52)'},
]
const deckBackPose = {y: -36, scale: 0.62, filter: 'brightness(0.4)'}

// The front card gets dealt: it swings out to the right and around, then
// slots in at the back of the stack
const deckFlick = {
	x: [0, 56, 0],
	y: [0, -20, -36],
	rotate: [0, 10, 0],
	scale: [1, 1.05, 0.62],
	filter: ['brightness(1)', 'brightness(1)', 'brightness(0.4)'],
	zIndex: [DECK_VISIBLE + 1, DECK_VISIBLE + 1, 0],
}

type DeckCard = {id: string; icon: string}

function useDeckCards(appsKeyed: Record<string, RegistryApp> | undefined): DeckCard[] {
	const storefront = useStorefront()
	return useMemo(() => {
		const section = storefront.sections.find((s) => s.id === DECK_STOREFRONT_SECTION)
		// Tailscale has its own card right next to this one
		const apps = section?.type === 'app-list' ? section.apps.filter((app) => app.id !== 'tailscale') : []
		if (apps.length >= DECK_VISIBLE) {
			return apps.map((app) => ({id: app.id, icon: app.icon}))
		}
		// The registry icon is used when synced; the gallery URL is the same asset
		return fallbackDeckApps.map((id) => ({
			id,
			icon: appsKeyed?.[id]?.icon ?? `https://getumbrel.github.io/umbrel-apps-gallery/${id}/icon.svg`,
		}))
	}, [storefront.sections, appsKeyed])
}

function AppDeck({cards, paused}: {cards: DeckCard[]; paused: boolean}) {
	const [front, setFront] = useState(0)
	useEffect(() => {
		if (paused) return
		const id = setInterval(() => setFront((f) => (f + 1) % cards.length), DECK_INTERVAL_MS)
		return () => clearInterval(id)
	}, [cards.length, paused])
	const leaving = (front + cards.length - 1) % cards.length

	return (
		<div className='absolute top-10 right-6 z-0 size-16'>
			{cards.map(({id, icon}, i) => {
				const depth = (i - front + cards.length) % cards.length
				const isLeaving = i === leaving
				return (
					<motion.div
						key={id}
						className='absolute inset-0'
						initial={false}
						animate={
							isLeaving
								? deckFlick
								: {...(deckPoses[depth] ?? deckBackPose), x: 0, rotate: 0, zIndex: DECK_VISIBLE - depth}
						}
						transition={
							isLeaving
								? {duration: 0.62, times: [0, 0.42, 1], ease: ['easeOut', 'easeInOut'], zIndex: {duration: 0}}
								: // The rest of the pile snaps forward with some bounce
									{type: 'spring', stiffness: 520, damping: 17, mass: 0.8, zIndex: {duration: 0}}
						}
					>
						<AppIcon src={icon} size={64} className='rounded-15 border-slate-300/20 shadow-xl' />
					</motion.div>
				)
			})}
		</div>
	)
}

// The Umbrel phone app's backup screen, rising out of the bottom of the
// Photos card. The card clips it, so only the top of the phone shows; it
// lifts a touch on hover.
function PhoneShot() {
	return (
		<img
			src={PHONE_BACKUP_SHOT}
			alt=''
			draggable={false}
			className='absolute top-4 left-1/2 w-[210px] max-w-[80%] -translate-x-1/2 drop-shadow-2xl transition-transform duration-500 group-hover:-translate-y-1.5 motion-reduce:transition-none'
		/>
	)
}
