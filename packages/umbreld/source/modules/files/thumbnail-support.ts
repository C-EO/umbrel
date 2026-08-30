import nodePath from 'node:path'

export const SUPPORTED_THUMBNAIL_EXTENSIONS = new Set([
	// Image formats
	'.webp',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.avif',
	'.heic',
	'.heif',
	// Video formats
	'.mkv',
	'.mov',
	'.mp4',
	'.3gp',
	'.avi',
])

export const THUMBNAIL_VARIANT = 'preview-112-webp-v1'
export const THUMBNAIL_FORMAT = 'webp'
export const THUMBNAIL_WIDTH = 112
export const THUMBNAIL_HEIGHT = 112
export const THUMBNAIL_QUALITY = 75

export type ThumbnailIdentityKind = 'content' | 'transient'

export type ThumbnailIdentity = {
	kind: ThumbnailIdentityKind
	key: string
}

const THUMBNAIL_KEY_PATTERN = /^[a-f0-9]{64}$/

export function supportsThumbnail(name: string) {
	return SUPPORTED_THUMBNAIL_EXTENSIONS.has(nodePath.extname(name).toLowerCase())
}

export function thumbnailFilename({kind, key}: ThumbnailIdentity) {
	if (!THUMBNAIL_KEY_PATTERN.test(key)) throw new TypeError('Invalid thumbnail identity key')
	return `${kind}-${THUMBNAIL_VARIANT}-${key}.${THUMBNAIL_FORMAT}`
}

export function parseThumbnailFilename(filename: string) {
	const match = new RegExp(`^(content|transient)-${THUMBNAIL_VARIANT}-([a-f0-9]{64})\\.${THUMBNAIL_FORMAT}$`, 'i').exec(
		filename,
	)
	if (!match) return
	return {
		kind: match[1].toLowerCase() as ThumbnailIdentityKind,
		variant: THUMBNAIL_VARIANT,
		key: match[2].toLowerCase(),
	}
}

export function thumbnailSystemPath(thumbnailDirectory: string, {kind, key}: ThumbnailIdentity) {
	if (!THUMBNAIL_KEY_PATTERN.test(key)) throw new TypeError('Invalid thumbnail identity key')
	return nodePath.join(thumbnailDirectory, kind, THUMBNAIL_VARIANT, key.slice(0, 2), `${key}.${THUMBNAIL_FORMAT}`)
}
