import {useCommandState} from 'cmdk'
import {createContext, SetStateAction, useContext, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {range} from 'remeda'

import {rankCmdkEntries, type CmdkEntry} from '@/components/cmdk-search'
import {CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList} from '@/components/ui/command'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Separator} from '@/components/ui/separator'
import {LOADING_DASH} from '@/constants'
import {FilesCmdkSearchProvider} from '@/features/files/cmdk-search-provider'
import {
	APPS_PATH as FILES_APPS_PATH,
	MACHINES_PATH as FILES_MACHINES_PATH,
	RECENTS_PATH as FILES_RECENTS_PATH,
	TRASH_PATH as FILES_TRASH_PATH,
} from '@/features/files/constants'
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {useMachinesCmdkEntries} from '@/features/machines/cmdk-entries'
import {useDebugInstallRandomApps} from '@/hooks/use-debug-install-random-apps'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useShortcuts} from '@/hooks/use-shortcuts'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import {resolveShortcutUrl} from '@/modules/desktop/shortcut-dialog'
import {resolveShortcutIcon, ShortcutIconImage} from '@/modules/desktop/shortcut-icon-image'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {useSettingsCmdkEntries} from '@/routes/settings/cmdk-entries'
import {trpcReact} from '@/trpc/trpc'
import {IS_DEV} from '@/utils/misc'

import {AppIcon} from './app-icon'
import {FadeScroller} from './fade-scroller'

// Rows shown for a query. Files results render below these.
const MAX_RESULTS = 25

const CmdkOpenContext = createContext<{
	open: boolean
	setOpen: (value: SetStateAction<boolean>) => void
} | null>(null)

export function useCmdkOpen() {
	const ctx = useContext(CmdkOpenContext)

	if (!ctx) throw new Error('useCmdkOpen must be used within a CommandRoot')

	return ctx
}

export function CmdkProvider({children}: {children: React.ReactNode}) {
	const [open, setOpen] = useState(false)

	// Register Cmd+K listener once here, not in useCmdkOpen (which is called
	// by multiple components and would register duplicate listeners).
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				setOpen((open) => !open)
			}
		}
		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [])

	return <CmdkOpenContext value={{open, setOpen}}>{children}</CmdkOpenContext>
}

export function CmdkMenu() {
	const {t} = useTranslation()
	const {open, setOpen} = useCmdkOpen()

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder={t('cmdk.input-placeholder')} />
			<Separator />
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				<CmdkContent />
			</ErrorBoundary>
		</CommandDialog>
	)
}

function CmdkContent() {
	const {t} = useTranslation()
	const {setOpen} = useCmdkOpen()
	const scrollRef = useRef<HTMLDivElement>(null)
	const query = useCommandState((state) => state.search).trim()

	// cmdk only auto-scrolls when the selected value changes, which no-ops while
	// typing keeps the same best match, so the list can stay stuck mid-scroll.
	// Reset before paint on every query change so results always start from the top.
	useLayoutEffect(() => {
		scrollRef.current?.scrollTo({top: 0})
	}, [query])

	const entries = useCmdkEntries()
	if (!entries) return null

	const results = query ? rankCmdkEntries(entries, query, MAX_RESULTS) : entries.filter((entry) => entry.default)

	return (
		<CommandList ref={scrollRef}>
			<FrequentApps onLaunchApp={() => setOpen(false)} />
			<CommandEmpty>{t('no-results-found')}</CommandEmpty>
			{results.map((entry) => (
				<CommandItem
					key={entry.id}
					value={entry.id}
					icon={entry.icon}
					iconVariant={entry.iconVariant}
					disabled={entry.disabled}
					onSelect={() => {
						entry.onSelect?.()
						setOpen(false)
					}}
				>
					{/* One flex item, so the subtitle sits a text space away rather than a flex gap */}
					<span>
						{entry.title}
						{entry.subtitle && <span className='opacity-50'> {entry.subtitle}</span>}
					</span>
				</CommandItem>
			))}
			<FilesCmdkSearchProvider query={query} close={() => setOpen(false)} />
		</CommandList>
	)
}

// Everything the palette can find, in priority order: when several entries
// match a query equally well, the earlier one wins.
function useCmdkEntries(): CmdkEntry[] | null {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const launchApp = useLaunchApp()
	const debugInstallRandomApps = useDebugInstallRandomApps()
	const userQ = trpcReact.user.get.useQuery()
	const {userApps, userAppsKeyed, isLoading: isLoadingUserApps} = useApps()
	// We only show installed community apps here, effectively limiting available
	// apps to those present in the official app store
	const availableApps = useAvailableApps()
	const {shortcuts} = useShortcuts()
	const settingsEntries = useSettingsCmdkEntries()
	const machineEntries = useMachinesCmdkEntries()

	if (userQ.isLoading || availableApps.isLoading || isLoadingUserApps || !userApps || !userAppsKeyed) return null

	const isMember = userQ.data?.role === 'member'
	const appStore = systemAppsKeyed['UMBREL_app-store']
	const files = systemAppsKeyed['UMBREL_files']
	const machines = systemAppsKeyed['UMBREL_machines']
	const filesEntry = (id: string, title: string, path: string): CmdkEntry => ({
		id: `files:${id}`,
		title,
		icon: files.icon,
		onSelect: () => navigate(`/files${path}`),
	})

	const systemEntries: CmdkEntry[] = [
		{
			id: 'system:update-all-apps',
			title: t('cmdk.update-all-apps'),
			default: true,
			icon: appStore.icon,
			onSelect: () => navigate('/app-store?dialog=updates'),
		},
		{
			id: 'system:live-usage',
			title: t('cmdk.live-usage'),
			default: true,
			icon: systemAppsKeyed['UMBREL_live-usage'].icon,
			onSelect: () => navigate(systemAppsKeyed['UMBREL_live-usage'].systemAppTo),
		},
		...(isMember
			? []
			: [
					{
						id: 'system:machines',
						title: machines.name,
						default: true,
						icon: machines.icon,
						onSelect: () => navigate(machines.systemAppTo),
					},
				]),
		{id: 'system:app-store', title: appStore.name, icon: appStore.icon, onSelect: () => navigate(appStore.systemAppTo)},
		{
			id: 'system:files',
			title: files.name,
			icon: files.icon,
			// TODO: THIS IS A HACK
			// We need a better approach to track the last visited path (possibly scroll position too?)
			// inside every page. We do this right now for the File app because it's has the most
			// UX-advantage (eg. user accidentally clicking close while they're in a deeply nested path)
			onSelect: () => navigate(getLastFilesPath(userQ.data?.userId) || files.systemAppTo),
		},
		filesEntry('recents', t('files-sidebar.recents'), FILES_RECENTS_PATH),
		filesEntry('apps', t('files-sidebar.apps'), FILES_APPS_PATH),
		...(isMember ? [] : [filesEntry('machines', t('machines'), FILES_MACHINES_PATH)]),
		filesEntry('trash', t('files-sidebar.trash'), FILES_TRASH_PATH),
		{
			id: 'system:settings',
			title: systemAppsKeyed['UMBREL_settings'].name,
			icon: systemAppsKeyed['UMBREL_settings'].icon,
			onSelect: () => navigate(systemAppsKeyed['UMBREL_settings'].systemAppTo),
		},
	]

	const readyApps = userApps.filter((app) => app.state === 'ready')
	const unreadyApps = userApps.filter((app) => app.state !== 'ready')
	// Apps not installed yet
	const installableApps = availableApps.apps.filter((app) => !userAppsKeyed[app.id])

	return [
		...systemEntries,
		...settingsEntries,
		...readyApps.map(
			(app): CmdkEntry => ({
				id: `app:${app.id}`,
				title: app.name,
				icon: app.icon,
				iconVariant: 'tile',
				onSelect: () => launchApp(app.id),
			}),
		),
		...(shortcuts ?? []).map(
			(shortcut): CmdkEntry => ({
				id: `shortcut:${shortcut.url}`,
				title: shortcut.title,
				icon: (
					<ShortcutIconImage
						src={resolveShortcutIcon(shortcut)}
						title={shortcut.title}
						className='h-full w-full rounded-6 sm:rounded-8'
					/>
				),
				onSelect: () => window.open(resolveShortcutUrl(shortcut), '_blank')?.focus(),
			}),
		),
		...machineEntries,
		...unreadyApps.map(
			(app): CmdkEntry => ({
				id: `app:${app.id}`,
				title: app.name,
				subtitle: `– ${appStateToString(app.state, t)}`,
				disabled: true,
				icon: app.icon,
				iconVariant: 'tile',
			}),
		),
		...installableApps.map(
			(app): CmdkEntry => ({
				id: `store:${app.id}`,
				title: app.name,
				subtitle: `${t('generic-in')} App Store`,
				icon: app.icon,
				iconVariant: 'tile',
				onSelect: () => navigate(`/app-store/${app.id}`),
			}),
		),
		...(IS_DEV
			? [{id: 'debug:install-random-apps', title: 'Install a bunch of random apps', onSelect: debugInstallRandomApps}]
			: []),
	]
}

function FrequentApps({onLaunchApp}: {onLaunchApp: () => void}) {
	const {t} = useTranslation()
	const lastAppsQ = trpcReact.apps.recentlyOpened.useQuery(undefined, {
		retry: false,
	})
	const lastApps = lastAppsQ.data ?? []
	const {userAppsKeyed} = useApps()

	const search = useCommandState((state) => state.search)

	// If there's a search query, don't show frequent apps
	if (search) return null
	if (!userAppsKeyed) return null
	if (!lastApps) return null
	if (lastApps.length === 0) return null

	return (
		<div className='mb-3 flex flex-col gap-3 md:mb-5 md:gap-5'>
			<div>
				<h3 className='mb-5 ml-2 hidden text-15 leading-tight font-semibold -tracking-2 md:block'>
					{t('cmdk.frequent-apps')}
				</h3>
				<FadeScroller direction='x' className='umbrel-hide-scrollbar w-full overflow-x-auto whitespace-nowrap'>
					{/* Show skeleton by default to prevent layout shift */}
					{lastAppsQ.isLoading &&
						range(0, 3).map((i) => <FrequentApp key={i} appId={''} icon='' name={LOADING_DASH} />)}
					{appsByFrequency(lastApps, 6).map((appId) => (
						<FrequentApp
							key={appId}
							appId={appId}
							icon={userAppsKeyed[appId]?.icon}
							name={userAppsKeyed[appId]?.name}
							onLaunch={onLaunchApp}
						/>
					))}
				</FadeScroller>
			</div>

			<Separator />
		</div>
	)
}

function appsByFrequency(lastOpenedApps: string[], count: number) {
	const openCounts = new Map<string, number>()

	lastOpenedApps.map((appId) => {
		if (!openCounts.has(appId)) {
			openCounts.set(appId, 1)
		} else {
			openCounts.set(appId, openCounts.get(appId)! + 1)
		}
	})

	const sortedAppIds = [...openCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, count)
		.map((a) => a[0])

	return sortedAppIds
}

function FrequentApp({
	appId,
	icon,
	name,
	onLaunch,
}: {
	appId: string
	icon: string
	name: string
	onLaunch?: () => void
}) {
	const launchApp = useLaunchApp()
	const isMobile = useIsMobile()
	return (
		<button
			className='inline-flex w-[75px] flex-col items-center gap-2 overflow-hidden rounded-8 border border-transparent p-1.5 outline-hidden transition-all hover:border-white/10 hover:bg-white/4 focus-visible:border-white/10 focus-visible:bg-white/4 active:border-white/20 md:w-[100px] md:p-2'
			onClick={() => {
				onLaunch?.()
				launchApp(appId)
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					// Prevent triggering first selected cmdk item
					e.preventDefault()
					launchApp(appId)
				}
			}}
		>
			<AppIcon src={icon} size={isMobile ? 48 : 64} className='rounded-10 lg:rounded-15' />
			<div className='w-full truncate text-[10px] -tracking-2 text-white/75 md:text-13'>{name ?? appId}</div>
		</button>
	)
}
