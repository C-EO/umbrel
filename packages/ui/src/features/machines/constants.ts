import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

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
	// Brand color used for logo glows and the mock desktop wallpaper
	color: string
}

// Brand colors for the popular OS catalog, keyed by familyId. Artwork lives in
// the machineIconSets map (os-icon.tsx) — keep the two key sets in sync.
export const osVisuals: Record<string, OsVisuals> = {
	ubuntu: {color: '#E95420'},
	fedora: {color: '#3C6EB4'},
	debian: {color: '#D70A53'},
	alpine: {color: '#0D597F'},
	android: {color: '#3DDC84'},
	'windows-11': {color: '#0078D4'},
	'windows-server': {color: '#0078D4'},
	'windows-7': {color: '#00ADEF'},
	'windows-xp': {color: '#7FBA00'},
	'windows-95': {color: '#008080'},
	'windows-98': {color: '#008080'},
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

// Repeated feature color: stop/error red (#f63636). Arbitrary-value Tailwind
// classes must be literal at build time, so we hoist whole class strings
// rather than interpolating the hex into a className.
export const machineStopBgClass = tw`bg-[#f63636]`
export const machineStopTextClass = tw`text-[#f63636]`
