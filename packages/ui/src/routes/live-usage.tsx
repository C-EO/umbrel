import {DialogPortal} from '@radix-ui/react-dialog'
import {MoreHorizontal} from 'lucide-react'
import {motion, useReducedMotion} from 'motion/react'
import {ReactNode, useEffect, useId, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'
import {Area, AreaChart, ResponsiveContainer, XAxis, YAxis} from 'recharts'

import {AppIcon} from '@/components/app-icon'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {LOADING_DASH} from '@/constants'
import {canStart, canStop, useAppInstall, useAppState} from '@/hooks/use-app-install'
import {extractIconAccentColor} from '@/hooks/use-color-thief'
import {useCpuForUi} from '@/hooks/use-cpu'
import {useDiskForUi} from '@/hooks/use-disk'
import {useMemoryForUi, useSystemMemoryForUi} from '@/hooks/use-memory'
import {cn} from '@/lib/utils'
import {useAppUninstall} from '@/modules/apps/use-app-uninstall'
import {AppT, systemAppsKeyed, useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {tw} from '@/utils/tw'

export default function LiveUsageDialog() {
	const {t} = useTranslation()
	const title = t('live-usage')
	const dialogProps = useDialogOpenProps('live-usage')

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent size='md' showScroll>
					<h1 className={immersiveDialogTitleClass}>{title}</h1>
					<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
						<LiveUsageContent />
					</ErrorBoundary>
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}

type SelectedTab = 'storage' | 'memory' | 'cpu'

const SEGMENT_COLORS = [
	'hsl(var(--color-brand))',
	'#5AC8F5', // blue
	'#BF5AF2', // purple
	'#FFB340', // orange
	'#FF6482', // pink
	'#66D4CF', // teal
	'#FFD426', // yellow
]
const OTHER_SEGMENT_COLOR = 'rgb(255 255 255 / 0.25)'
const MAX_SEGMENTS = 6

const cardSpring = {type: 'spring', duration: 0.2, bounce: 0.15} as const
const listSpring = {type: 'spring', duration: 0.5, bounce: 0.2} as const

// Backfill the initial all-zero baseline with the first real sample so the
// chart doesn't draw a wall that slides across the card for 30 seconds
function appendChartPoint(prev: Array<{value: number}>, value: number) {
	if (value !== 0 && prev.every((point) => point.value === 0)) return new Array<{value: number}>(30).fill({value})
	return [...prev.slice(1), {value}]
}

function LiveUsageContent() {
	const {t} = useTranslation()
	const {search} = useLocation()
	const navigate = useNavigate()
	const queryParams = new URLSearchParams(search)
	const selectedTab = (queryParams.get('tab') as SelectedTab) || 'cpu'

	const setSelectedTab = (tab: SelectedTab) => {
		queryParams.set('tab', tab)
		navigate({search: queryParams.toString()})
	}

	// Poll for cpu and memory usage, but do not poll for disk usage
	// As disk-usage doesn't change much in real-time but the calculation causes
	// CPU spikes
	const cpuUsage = useCpuForUi({poll: true})
	// The card number/chart only need the light meminfo endpoint. The per-app
	// breakdown (docker ps + a cgroup sweep per call in umbreld) is fetched once
	// on open — pre-building every card's segment layer and pinning stable
	// colors — and polls only while the memory tab is active.
	const memorySystem = useSystemMemoryForUi({poll: true})
	const memoryUsage = useMemoryForUi({poll: selectedTab === 'memory'})
	const diskUsage = useDiskForUi()

	const colors = useAppColors(
		[...(cpuUsage.apps ?? []), ...(memoryUsage.apps ?? []), ...(diskUsage.apps ?? [])].map((app) => app.id),
	)
	const cpuSegments = useSegments({apps: cpuUsage.apps, total: 100, usedFraction: cpuUsage.progress, colors})
	const memorySegments = useSegments({
		apps: memoryUsage.apps,
		total: memoryUsage.size,
		usedFraction: memorySystem.progress,
		colors,
	})
	const storageSegments = useSegments({
		apps: diskUsage.apps,
		total: diskUsage.size,
		usedFraction: diskUsage.progress,
		colors,
	})

	// Initialize cpu and memory charts with 30 "0" values so there's a clean base line from where they start populating with
	const [cpuChartData, setCpuChartData] = useState<Array<{value: number}>>(new Array(30).fill({value: 0}))
	const [memoryChartData, setMemoryChartData] = useState<Array<{value: number}>>(new Array(30).fill({value: 0}))

	// Update cpu and memory charts whenever their progress values update
	useEffect(() => {
		setCpuChartData((prevData) => appendChartPoint(prevData, cpuUsage.progress * 100 || 0))
	}, [cpuUsage.progress])

	useEffect(() => {
		setMemoryChartData((prevData) => appendChartPoint(prevData, memorySystem.progress * 100 || 0))
	}, [memorySystem.progress])

	return (
		<div className='grid gap-y-5'>
			{/* Hidden on mobile, as we show regular tabs */}
			<div className='hidden gap-3 sm:grid sm:grid-cols-3'>
				<UsageTabButton onClick={() => setSelectedTab('cpu')}>
					<UsageCard
						title={t('cpu')}
						value={cpuUsage.value}
						progressLabel={cpuUsage.secondaryValue}
						segments={cpuSegments}
						progress={cpuUsage.progress}
						active={selectedTab === 'cpu'}
						chart={cpuChartData}
					/>
				</UsageTabButton>
				<UsageTabButton onClick={() => setSelectedTab('memory')}>
					<UsageCard
						title={t('memory')}
						value={memorySystem.value}
						valueSub={memorySystem.valueSub}
						progressLabel={memorySystem.secondaryValue}
						segments={memorySegments}
						progress={memorySystem.progress}
						rightChildren={memorySystem.isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
						active={selectedTab === 'memory'}
						chart={memoryChartData}
					/>
				</UsageTabButton>
				<UsageTabButton onClick={() => setSelectedTab('storage')}>
					<UsageCard
						title={t('storage')}
						value={diskUsage.value}
						valueSub={diskUsage.valueSub}
						progressLabel={diskUsage.secondaryValue}
						segments={storageSegments}
						progress={diskUsage.progress}
						rightChildren={
							<>
								{diskUsage.isDiskLow && <ErrorMessage>{t('storage.low')}</ErrorMessage>}
								{diskUsage.isDiskFull && <ErrorMessage>{t('storage.full')}</ErrorMessage>}
							</>
						}
						active={selectedTab === 'storage'}
					/>
				</UsageTabButton>
			</div>

			{/* Shown only on mobile */}
			<div className='sm:hidden'>
				<SegmentedControl
					size='lg'
					tabs={[
						{id: 'cpu', label: t('cpu')},
						{id: 'memory', label: t('memory')},
						{id: 'storage', label: t('storage')},
					]}
					value={selectedTab}
					onValueChange={setSelectedTab}
				/>
			</div>

			{/* Key to make sure we reset the error */}
			<ErrorBoundary key={selectedTab} FallbackComponent={ErrorBoundaryCardFallback}>
				{selectedTab === 'cpu' && <CpuSection colors={colors} chart={cpuChartData} />}
				{selectedTab === 'memory' && <MemorySection colors={colors} chart={memoryChartData} />}
				{selectedTab === 'storage' && <StorageSection colors={colors} />}
			</ErrorBoundary>
		</div>
	)
}
// ---

function StorageSection({colors}: {colors: AppColors}) {
	const {t, i18n} = useTranslation()
	const {isLoading, value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull, apps, size} = useDiskForUi({
		poll: true,
	})
	const segments = useSegments({apps, total: size, usedFraction: progress, colors})
	// Pass undefined rather than an empty fragment: a fragment is always truthy,
	// which would render an empty header row and make this card taller
	const errors =
		isDiskLow || isDiskFull ? (
			<>
				{isDiskLow && <ErrorMessage>{t('storage.low')}</ErrorMessage>}
				{isDiskFull && <ErrorMessage>{t('storage.full')}</ErrorMessage>}
			</>
		) : undefined

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
					active
					value={value}
					valueSub={valueSub}
					progressLabel={secondaryValue}
					segments={segments}
					rightChildren={errors}
				/>
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system, systemAppsKeyed.UMBREL_files]} />}
			<AppList apps={apps} colors={colors} formatValue={(v) => maybePrettyBytes(v, i18n.language)} />
		</>
	)
}

function MemorySection({colors, chart}: {colors: AppColors; chart?: Array<{value: number}>}) {
	const {t, i18n} = useTranslation()
	const {isLoading, value, valueSub, secondaryValue, progress, isMemoryLow, apps, size} = useMemoryForUi({poll: true})
	const segments = useSegments({apps, total: size, usedFraction: progress, colors})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
					active
					value={value}
					valueSub={valueSub}
					progressLabel={secondaryValue}
					segments={segments}
					chart={chart}
					rightChildren={isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
				/>
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			<AppList apps={apps} colors={colors} formatValue={(v) => maybePrettyBytes(v, i18n.language)} />
		</>
	)
}

function CpuSection({colors, chart}: {colors: AppColors; chart?: Array<{value: number}>}) {
	const {i18n} = useTranslation()
	const {isLoading, value, secondaryValue, progress, apps} = useCpuForUi({poll: true})
	const segments = useSegments({apps, total: 100, usedFraction: progress, colors})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard active value={value} progressLabel={secondaryValue} segments={segments} chart={chart} />
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			<AppList apps={apps} colors={colors} formatValue={(n) => formatNumberI18n({n, locale: i18n.language}) + '%'} />
		</>
	)
}

// --- Composition bar

type BarSegment = {id: string; label: string; color: string; start: number; width: number}

/**
 * Colors for app segments: the app icon's dominant hue when one is
 * extractable, otherwise a palette color assigned by first appearance. Either
 * way an app keeps one color in every bar and list for the lifetime of the
 * dialog. Assignment happens in the commit-phase effect (ids arrive
 * usage-sorted, so the biggest consumers get distinct palette slots first)
 * keeping render pure; the async icon color overwrites the palette fallback
 * when extraction resolves.
 */
function useAppColors(appIds: string[]) {
	const resolveApp = useResolveApp()
	const requestedRef = useRef(new Set<string>())
	const paletteSizeRef = useRef(0)
	const [colors, setColors] = useState(() => new Map<string, string>())

	const idsKey = appIds.join(',')
	useEffect(() => {
		for (const id of idsKey.split(',')) {
			if (!id || requestedRef.current.has(id)) continue
			const {icon} = resolveApp(id)
			// No icon yet (apps provider still loading) — leave unmarked so we retry
			if (!icon) continue
			requestedRef.current.add(id)
			// Every appearing app gets a deterministic fallback immediately, so
			// even rows that never make a bar segment are distinguishable from
			// the gray "Other" catch-all
			const fallback = SEGMENT_COLORS[paletteSizeRef.current++ % SEGMENT_COLORS.length]
			setColors((prev) => new Map(prev).set(id, fallback))
			extractIconAccentColor(icon).then((color) => {
				if (color) setColors((prev) => new Map(prev).set(id, color))
			})
		}
	}, [idsKey, resolveApp])

	return useMemo(
		() => ({
			get(id: string) {
				return colors.get(id)
			},
		}),
		[colors],
	)
}
type AppColors = ReturnType<typeof useAppColors>

function useSegments({
	apps,
	total,
	usedFraction,
	colors,
}: {
	apps?: Array<{id: string; used: number}>
	total?: number
	usedFraction: number
	colors: AppColors
}): BarSegment[] {
	const {t} = useTranslation()
	const resolveApp = useResolveApp()

	if (!apps || !total) return []

	const segments: BarSegment[] = []
	// Cap the bar at the displayed used figure, not at full bar capacity: the
	// per-app numbers can sum past it (umbreld floors the system share at 2GB),
	// and the bar must never overstate the number next to it
	const usedCap = Math.min(usedFraction, 1)
	let cursor = 0
	for (const app of apps) {
		if (segments.length >= MAX_SEGMENTS) break
		const width = Math.min(app.used / total, usedCap - cursor)
		// Apps are sorted by usage, so everything after the first sliver is smaller
		if (width < 0.004) break
		segments.push({
			id: app.id,
			label: resolveApp(app.id).name,
			// The commit-phase assignment lands one frame after first render; the
			// gray placeholder blends into the assigned color via the bar transition
			color: colors.get(app.id) ?? OTHER_SEGMENT_COLOR,
			start: cursor,
			width,
		})
		cursor += width
	}
	// Whatever is used but not attributed to a segment above (small apps, system
	// overhead the per-app numbers don't cover)
	const otherWidth = usedCap - cursor
	if (otherWidth > 0.002) {
		segments.push({id: 'other-usage', label: t('other'), color: OTHER_SEGMENT_COLOR, start: cursor, width: otherWidth})
	}
	return segments
}

// `flat` crossfades to a single brand-colored fill of the overall usage, so
// inactive cards read as a plain progress bar and active ones as the breakdown
function CompositionBar({segments, flat, progress}: {segments: BarSegment[]; flat?: boolean; progress?: number}) {
	// Prefer the overall usage fraction: it's known before the per-app
	// breakdown arrives, so the flat bar never renders at 0% while waiting
	const flatWidth = Math.min(progress ?? segments.reduce((sum, segment) => sum + segment.width, 0), 1)
	return (
		<div className='relative h-2 overflow-hidden rounded-full bg-white/10'>
			<div
				className={cn(
					'absolute inset-y-0 left-0 rounded-full transition-[width,opacity] duration-700',
					!flat && 'opacity-0',
				)}
				style={{width: `${flatWidth * 100}%`, backgroundColor: 'hsl(var(--color-brand))'}}
			/>
			{segments.map((segment) => (
				<div
					key={segment.id}
					title={flat ? undefined : segment.label}
					className={cn(
						'absolute inset-y-0 rounded-[3px] transition-[left,width,background-color,opacity] duration-700',
						flat && 'opacity-0',
					)}
					style={{
						left: `calc(${segment.start * 100}% + 1px)`,
						width: `max(2px, calc(${segment.width * 100}% - 2px))`,
						backgroundColor: segment.color,
					}}
				/>
			))}
		</div>
	)
}

// --- Usage cards

function UsageTabButton({children, onClick}: {children: ReactNode; onClick: () => void}) {
	const reduceMotion = Boolean(useReducedMotion())
	return (
		<motion.button
			type='button'
			onClick={onClick}
			whileHover={reduceMotion ? undefined : {scale: 1.02}}
			whileTap={reduceMotion ? undefined : {scale: 0.98}}
			transition={cardSpring}
			className='h-full rounded-24 text-left outline-hidden will-change-transform focus-visible:ring-2 focus-visible:ring-white/20'
		>
			{children}
		</motion.button>
	)
}

function UsageCard({
	active,
	title,
	value,
	valueSub,
	progressLabel,
	segments,
	progress,
	rightChildren,
	chart,
}: {
	active?: boolean
	title?: string
	value?: string
	valueSub?: string
	progressLabel?: string
	segments: BarSegment[]
	progress?: number
	rightChildren?: ReactNode
	chart?: Array<{value: number}>
}) {
	// A localized title could contain characters that are invalid in url(#…)
	// references (and titles repeat across cards), so use a generated id
	const chartGradientId = `${useId()}-chart-gradient`
	return (
		<div className='settings-edge-material relative h-full overflow-hidden rounded-24 p-5'>
			<div
				className={cn(
					'pointer-events-none absolute inset-0 bg-linear-to-b from-brand/15 to-transparent transition-opacity duration-300',
					active ? 'opacity-100' : 'opacity-0',
				)}
			/>
			{chart && (
				<ResponsiveContainer
					style={{position: 'absolute', bottom: -1, left: '-0.5%', zIndex: 0}}
					width='101%'
					height='100%'
				>
					<AreaChart data={chart} margin={{bottom: 0}}>
						<defs>
							<linearGradient id={chartGradientId} x1='0' y1='0' x2='0' y2='1'>
								<stop
									offset='5%'
									style={{stopColor: active ? 'hsl(var(--color-brand) / 0.3)' : 'rgba(255, 255, 255, 0.05)'}}
								/>
								<stop
									offset='95%'
									style={{stopColor: active ? 'hsl(var(--color-brand) / 0)' : 'rgba(255, 255, 255, 0)'}}
								/>
							</linearGradient>
						</defs>
						<YAxis domain={[0, 100]} hide={true} />
						<XAxis hide={true} />
						<Area
							isAnimationActive={false}
							type='monotone'
							dataKey='value'
							style={{stroke: active ? 'hsl(var(--color-brand) / 0.2)' : 'rgba(255, 255, 255, 0.05)'}}
							fillOpacity={1}
							fill={`url(#${chartGradientId})`}
							legendType='none'
							dot={false}
						/>
					</AreaChart>
				</ResponsiveContainer>
			)}
			<div className='relative flex flex-col gap-3'>
				{(title || rightChildren) && (
					<div className='flex min-w-0 items-center justify-between gap-2 text-13 -tracking-2'>
						<span className='truncate font-semibold text-white/45'>{title}</span>
						{rightChildren}
					</div>
				)}
				<div className='flex min-w-0 items-baseline gap-1.5 text-24 leading-none font-semibold -tracking-3'>
					<span className='min-w-0 truncate'>{value ?? LOADING_DASH}</span>
					{valueSub && <span className='min-w-0 truncate text-13 font-semibold text-white/45'>{valueSub}</span>}
				</div>
				<div className='flex flex-col gap-2'>
					{progressLabel && <div className='text-13 font-medium -tracking-2 text-white/40'>{progressLabel}</div>}
					<CompositionBar segments={segments} flat={!active} progress={progress} />
				</div>
			</div>
			<div
				className={cn(
					'pointer-events-none absolute inset-0 rounded-24 border border-brand/40 transition-opacity duration-300',
					active ? 'opacity-100' : 'opacity-0',
				)}
			/>
		</div>
	)
}

function ErrorMessage({children}: {children?: ReactNode}) {
	return (
		<div className='flex items-center gap-2 text-[#F45A5A]'>
			<div className='h-[5px] w-[5px] animate-pulse rounded-full bg-current ring-3 ring-[#F45A5A]/20'></div>
			<div className={cn('text-13 font-medium -tracking-2', 'leading-inter-trimmed')}>{children}</div>
		</div>
	)
}

// --- App list

function useResolveApp() {
	const {t} = useTranslation()
	const {userAppsKeyed} = useApps()

	return useMemo(
		() =>
			(id: string): {name: string; icon?: string} => {
				if (id === 'umbreld-system') {
					return {name: systemAppsKeyed.UMBREL_system.name, icon: systemAppsKeyed.UMBREL_system.icon}
				}
				if (id === 'umbreld-files') {
					return {name: systemAppsKeyed.UMBREL_files.name, icon: systemAppsKeyed.UMBREL_files.icon}
				}
				// Apps a member can't see are folded into a single entry server-side
				if (id === 'other') {
					return {name: t('other'), icon: systemAppsKeyed.UMBREL_system.icon}
				}
				return {name: userAppsKeyed?.[id]?.name || t('unknown-app'), icon: userAppsKeyed?.[id]?.icon}
			},
		[t, userAppsKeyed],
	)
}

function AppList({
	apps,
	formatValue,
	colors,
}: {
	apps?: {id: string; used: number}[]
	formatValue: (value: number) => string
	colors: AppColors
}) {
	const {userAppsKeyed} = useApps()
	const resolveApp = useResolveApp()
	const userQ = trpcReact.user.get.useQuery()
	// Members see shared apps but can't manage them
	const isMember = userQ.data?.role === 'member'

	if (userAppsKeyed === undefined) return null
	if (!apps || apps.length === 0) return null

	// Apps are sorted by usage, so the first one is the biggest consumer
	const maxUsed = Math.max(apps[0]?.used ?? 0, Number.EPSILON)

	return (
		<div className={appListClass}>
			{apps.map(({id, used}) => {
				const {name, icon} = resolveApp(id)
				// System entries (System, Files, "other") aren't manageable apps
				const isUserApp = Boolean(userAppsKeyed[id])
				return (
					<AppListRow
						key={id}
						icon={icon}
						title={name}
						value={formatValue(used)}
						barColor={colors.get(id) ?? OTHER_SEGMENT_COLOR}
						barShare={used / maxUsed}
						status={isUserApp && <AppRowStatus appId={id} />}
						menu={
							!isMember &&
							(isUserApp ? <AppRowMenu appId={id} /> : <span aria-hidden='true' className='size-7 shrink-0' />)
						}
					/>
				)
			})}
		</div>
	)
}

function AppRowMenu({appId}: {appId: string}) {
	const {t} = useTranslation()
	const appInstall = useAppInstall(appId)
	const {promptUninstall, dialogs: uninstallDialogs} = useAppUninstall(appId, appInstall)

	const state = appInstall.state
	const startDisabled = !canStart(state)
	const stopDisabled = !canStop(state)

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						aria-label={t('live-usage.app-options')}
						className='shrink-0 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white focus:outline-hidden focus-visible:bg-white/10 focus-visible:text-white data-[state=open]:bg-white/10 data-[state=open]:text-white'
					>
						<MoreHorizontal className='size-4' />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					{/* Startable covers both stopped and offline (unknown) apps */}
					{canStart(state) ? (
						<DropdownMenuItem disabled={startDisabled} onSelect={startDisabled ? undefined : appInstall.start}>
							{t('start')}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem disabled={stopDisabled} onSelect={stopDisabled ? undefined : appInstall.stop}>
							{t('stop')}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						className='text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
						onSelect={promptUninstall}
					>
						{t('desktop.app.context.uninstall')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{uninstallDialogs}
		</>
	)
}

// Grayed helper text next to the app name while the app is in a transient
// state, mirroring the desktop icon labels
function AppRowStatus({appId}: {appId: string}) {
	const {t} = useTranslation()
	// Display-only: read from the shared apps list instead of mounting a
	// per-app state controller for every row
	const state = useAppState(appId)

	let text: string | undefined
	switch (state) {
		case 'installing':
			text = t('app.installing') + '...'
			break
		case 'starting':
			text = t('app.starting') + '...'
			break
		case 'restarting':
			text = t('app.restarting') + '...'
			break
		case 'stopping':
			text = t('app.stopping') + '...'
			break
		case 'uninstalling':
			text = t('app.uninstalling') + '...'
			break
		case 'updating':
			text = t('app.updating') + '...'
			break
		case 'stopped':
			text = t('app.stopped')
			break
		case 'unknown':
			text = t('app.offline')
			break
	}
	if (!text) return null

	return <span className='shrink-0 text-13 -tracking-2 text-white/40'>{text}</span>
}

export function AppListSkeleton({systemApps}: {systemApps?: Array<AppT>}) {
	const {userApps} = useApps()
	// Show a list of user-installed and system apps
	// with no values
	return (
		<div className={appListClass}>
			{[...(systemApps || []), ...(userApps || [])].map((app) => {
				return <AppListRow key={app.id} title={app.name} icon={app.icon} value='' />
			})}
		</div>
	)
}

const appListClass = tw`settings-edge-material overflow-hidden rounded-24`

function AppListRow({
	icon,
	title,
	value,
	disabled,
	barColor,
	barShare,
	status,
	menu,
}: {
	icon?: string
	title: string
	value: string
	disabled?: boolean
	barColor?: string
	barShare?: number
	status?: ReactNode
	menu?: ReactNode
}) {
	const reduceMotion = Boolean(useReducedMotion())
	return (
		<motion.div
			layout={reduceMotion ? false : 'position'}
			transition={listSpring}
			// Rows carry their own separator so it travels with them when they
			// re-sort; a container divide-y would stay pinned to the old positions
			className={cn(
				'flex min-w-0 items-center gap-2 border-b border-white/6 p-3 last:border-b-0',
				disabled && 'opacity-50',
			)}
		>
			<AppIcon src={icon} size={28} className={cn('rounded-8 shadow-md', disabled && 'grayscale')} />
			<div className='flex min-w-0 flex-1 items-center gap-1.5'>
				<span className='min-w-0 truncate text-15 font-medium -tracking-4 opacity-90'>{title}</span>
				{status}
			</div>
			{barShare !== undefined && (
				<span className='h-1 w-14 shrink-0 overflow-hidden rounded-full bg-white/10 sm:w-24'>
					<span
						className='block h-full rounded-full transition-[width,background-color] duration-700'
						style={{width: `${Math.max(0, Math.min(1, barShare)) * 100}%`, backgroundColor: barColor}}
					/>
				</span>
			)}
			<span className='shrink-0 text-right text-15 font-normal -tracking-3 text-white/45 uppercase tabular-nums sm:min-w-[76px]'>
				{value}
			</span>
			{menu}
		</motion.div>
	)
}
