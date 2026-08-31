import nodePath from 'node:path'

import mime from 'mime-types'

// mime-db does not know several camera and media extensions, and classifies
// .mts as a 3D model. Keep these overrides narrow so ordinary file MIME lookup
// continues to follow mime-types.
const MIME_TYPE_OVERRIDES = new Map([
	['.jfif', 'image/jpeg'],
	['.dng', 'image/x-adobe-dng'],
	['.cr2', 'image/x-canon-cr2'],
	['.cr3', 'image/x-canon-cr3'],
	['.nef', 'image/x-nikon-nef'],
	['.arw', 'image/x-sony-arw'],
	['.raf', 'image/x-fuji-raf'],
	['.orf', 'image/x-olympus-orf'],
	['.rw2', 'image/x-panasonic-rw2'],
	['.mts', 'video/mp2t'],
	['.m2ts', 'video/mp2t'],
	['.360', 'video/mp4'],
	['.insv', 'video/mp4'],
])

export function lookupMimeType(name: string) {
	return MIME_TYPE_OVERRIDES.get(nodePath.extname(name).toLowerCase()) ?? mime.lookup(name)
}
