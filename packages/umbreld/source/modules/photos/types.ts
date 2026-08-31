import nodePath from 'node:path'

export const PHOTO_KINDS = ['photo', 'video'] as const
export const PHOTO_SUB_KINDS = ['live', 'panorama', 'screenshot', 'spherical'] as const
export const PHOTO_SOURCE_TYPES = ['umbrel', 'iphone'] as const
export const PHOTO_SCOPE_MODES = ['everything', 'everything-except', 'only'] as const

export type PhotoKind = (typeof PHOTO_KINDS)[number]
export type PhotoSubKind = (typeof PHOTO_SUB_KINDS)[number]
export type PhotoSourceType = (typeof PHOTO_SOURCE_TYPES)[number]
export type PhotoScopeMode = (typeof PHOTO_SCOPE_MODES)[number]

export const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif'])
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.3gp'])

export function photoKind(name: string): PhotoKind | undefined {
	const extension = nodePath.extname(name).toLowerCase()
	if (PHOTO_EXTENSIONS.has(extension)) return 'photo'
	if (VIDEO_EXTENSIONS.has(extension)) return 'video'
}

export function supportsPhotos(name: string) {
	return photoKind(name) !== undefined
}

export type PhotoFilter = {
	query?: string
	kind?: PhotoKind
	subKind?: PhotoSubKind
	favorite?: boolean
	deleted?: boolean
	sourceIds?: string[]
	albumIds?: string[]
	dates?: Array<{from: number; to: number}>
}

export type PhotoItem = {
	id: string
	kind: PhotoKind
	subKind?: PhotoSubKind
	takenAt: number
	takenAtOffsetMinutes?: number
	width: number
	height: number
	durationMs?: number
	isFavorite: boolean
	tint?: number
}

export type PhotoItemDetail = PhotoItem & {
	fileName: string
	sizeBytes: number
	source: {id: string; name: string; type: PhotoSourceType}
	path: string
	createdAt: number
	importedAt: number
	exif?: {
		make?: string
		model?: string
		lens?: string
		focalLength?: string
		aperture?: string
		exposure?: string
		iso?: number
		userComment?: string
	}
	location?: {lat: number; lng: number; altitude?: number}
	albums: Array<{id: string; name: string}>
}

export type PhotoAlbum = {
	id: string
	name: string
	count: number
	coverId?: string
	takenFrom?: number
	takenTo?: number
	createdAt: number
}

export type PhotoSource = {
	id: string
	type: PhotoSourceType
	name: string
	lastImportAt?: number
	createdAt: number
	stats: {photos: number; videos: number; sizeBytes: number}
	scope?: {mode: PhotoScopeMode; paths: string[]}
}

export type PhotoIndexingState =
	| {phase: 'indexing'}
	| {phase: 'enriching'; completed: number; total: number; percentage: number}
	| {phase: 'ready'; completed: number; total: number; percentage: 100}
	| {phase: 'degraded'; completed?: number; total?: number; percentage?: number; error?: string}

export type PhotoSummary = {
	counts: {items: number; favorites: number; photos: number; videos: number; deleted: number}
	sizeBytes: number
	bySubKind: Record<PhotoSubKind, number>
	bySource: Record<string, number>
	months: Array<{year: number; month: number; count: number}>
}
