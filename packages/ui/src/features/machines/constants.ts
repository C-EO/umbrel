import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// Served from public/ (not bundled) — umbreld's CSP disallows data: image
// URIs, so these must stay regular http URLs rather than Vite-inlined assets
const osAlpine = '/assets/machines/os-alpine.svg'
const osAndroid = '/assets/machines/os-android.svg'
const osDebian = '/assets/machines/os-debian.svg'
const osFedora = '/assets/machines/os-fedora.svg'
const osUbuntu = '/assets/machines/os-ubuntu.svg'
const osWindows11 = '/assets/machines/os-windows-11.svg'
const osWindows95 = '/assets/machines/os-windows-95.svg'
const osWindowsXp = '/assets/machines/os-windows-xp.svg'

export const MACHINES_PATH = '/machines'
export const MACHINES_ADD_PATH = '/machines/new'
export const MACHINES_CONFIGURE_PATH = '/machines/new/configure'

export const machinePath = (machineId: string) => `${MACHINES_PATH}/${machineId}`
export const machineFullscreenPath = (machineId: string) => `${MACHINES_PATH}/${machineId}/fullscreen`

// Shared timing for the layout morph between views (container resize and the
// header/tab bar position shifts all move in lockstep)
export const layoutMorphTransition = {
	layout: {duration: 0.35, ease: [0.32, 0.72, 0, 1] as [number, number, number, number]},
}

export const DEFAULT_DISK_SIZE_GB = 100
export const MAX_DISK_SIZE_GB = 10_000
export const DEFAULT_CORES = 4
export const DEFAULT_MEMORY_GB = 4
export const MIN_MEMORY_GB = 1

// Core options are dynamic: 1 up to the host's thread count (system.cpuUsage.threads)
export const coreOptions = (threads: number | undefined) =>
	Array.from({length: Math.max(1, threads ?? DEFAULT_CORES)}, (_, i) => i + 1)

type OsVisuals = {
	logo?: string
	// Brand color used for logo glows and the mock desktop wallpaper
	color: string
	// Some logos (e.g. Debian's swirl) need a solid circle behind them to read well
	circleBackground?: boolean
}

// Visuals for the popular OS catalog. Anything not in here (custom ISOs)
// falls back to a generic disc icon.
export const osVisuals: Record<string, OsVisuals> = {
	ubuntu: {logo: osUbuntu, color: '#E95420'},
	fedora: {logo: osFedora, color: '#3C6EB4'},
	debian: {logo: osDebian, color: '#D70A53', circleBackground: true},
	alpine: {logo: osAlpine, color: '#0D597F'},
	android: {logo: osAndroid, color: '#3DDC84'},
	'windows-11': {logo: osWindows11, color: '#0078D4'},
	'windows-server': {logo: osWindows11, color: '#0078D4'},
	'windows-7': {logo: osWindows11, color: '#00ADEF'},
	'windows-xp': {logo: osWindowsXp, color: '#7FBA00'},
	'windows-95': {logo: osWindows95, color: '#008080'},
	'windows-98': {logo: osWindows95, color: '#008080'},
}

export const customOsVisuals: OsVisuals = {color: '#8f8f8f'}

export const getOsVisuals = (osId: string): OsVisuals => osVisuals[osId] ?? customOsVisuals

// Shared machine control button (power / stop / restart / menu). One base with
// the small per-surface differences (size, glass tint, disabled opacity)
// composed via cn(). Arbitrary-value classes stay literal so Tailwind can see
// them at build time.
const machineControlButtonClass = tw`flex shrink-0 items-center justify-center rounded-full border border-white/10 text-white backdrop-blur-xl transition-[background-color,transform] duration-200 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/20 active:scale-90 disabled:pointer-events-none`

// List rows: 40px (48px on md), lighter glass
export const machineRowButtonClass = cn(
	machineControlButtonClass,
	tw`size-10 bg-[rgba(50,50,50,0.64)] hover:bg-[rgba(76,76,76,0.64)] disabled:opacity-50 md:size-12`,
)

// Machine view rail: fixed 48px, darker glass with the immersive close shadow
export const machineRailButtonClass = cn(
	machineControlButtonClass,
	tw`size-12 bg-[rgba(30,30,30,0.75)] shadow-immersive-dialog-close hover:bg-[rgba(60,60,60,0.75)] disabled:opacity-40`,
)

// Repeated feature colors: stop/error red (#f63636) and storage purple
// (#722fff). Arbitrary-value Tailwind classes must be literal at build time, so
// we hoist whole class strings rather than interpolating the hex into a className.
export const machineStopBgClass = tw`bg-[#f63636]`
export const machineStopTextClass = tw`text-[#f63636]`
export const machineStoragePurpleClass = tw`[&>*]:bg-[#722fff]`
