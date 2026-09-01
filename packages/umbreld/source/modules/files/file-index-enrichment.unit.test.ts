import {execFile} from 'node:child_process'
import {lstat, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import {promisify} from 'node:util'

import {afterEach, expect, test, vi} from 'vitest'

import {execa} from 'execa'

import {
	THUMBNAIL_HEIGHT,
	THUMBNAIL_QUALITY,
	THUMBNAIL_VARIANTS,
	THUMBNAIL_WIDTH,
	parseThumbnailFilename,
	thumbnailFilename,
	type ThumbnailVariant,
} from './thumbnail-support.js'
import {
	decodeExifUserComment,
	enrichmentQueueConcurrency,
	extractMediaMetadata,
	extractThumbnailTint,
	generateThumbnailFile,
	generateThumbnailFiles,
	hashFileRevision,
	THUMBNAIL_GENERATION_TIMEOUT_MS,
} from './file-index-enrichment.js'

vi.mock('execa')

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []
const metadataSeparator = '\u001f'

type PhotoIdentifyMetadata = {
	width: string
	height: string
	orientation: string
	originalDate: string
	originalOffset: string
	digitizedDate: string
	digitizedOffset: string
	dateTime: string
	dateTimeOffset: string
	make: string
	model: string
	lens: string
	focalLength: string
	aperture: string
	exposure: string
	photographicSensitivity: string
	legacyIso: string
	latitude: string
	latitudeRef: string
	longitude: string
	longitudeRef: string
	altitude: string
	altitudeRef: string
	projection: string
	exifContentIdentifier: string
	makerContentIdentifier: string
	xmpContentIdentifier: string
	userCommentMarker: string
	dngDate: string
	dngMake: string
	dngModel: string
	dngLens: string
	dngFocalLength: string
	dngAperture: string
	dngExposure: string
	dngIso: string
	dngLatitude: string
	dngLongitude: string
	dngAltitude: string
}

function photoIdentifyMetadata(overrides: Partial<PhotoIdentifyMetadata> = {}) {
	const metadata: PhotoIdentifyMetadata = {
		width: '4032',
		height: '3024',
		orientation: '',
		originalDate: '',
		originalOffset: '',
		digitizedDate: '',
		digitizedOffset: '',
		dateTime: '',
		dateTimeOffset: '',
		make: '',
		model: '',
		lens: '',
		focalLength: '',
		aperture: '',
		exposure: '',
		photographicSensitivity: '',
		legacyIso: '',
		latitude: '',
		latitudeRef: '',
		longitude: '',
		longitudeRef: '',
		altitude: '',
		altitudeRef: '',
		projection: '',
		exifContentIdentifier: '',
		makerContentIdentifier: '',
		xmpContentIdentifier: '',
		userCommentMarker: '',
		dngDate: '',
		dngMake: '',
		dngModel: '',
		dngLens: '',
		dngFocalLength: '',
		dngAperture: '',
		dngExposure: '',
		dngIso: '',
		dngLatitude: '',
		dngLongitude: '',
		dngAltitude: '',
		...overrides,
	}
	return {stdout: Object.values(metadata).join(metadataSeparator)}
}

function exifUserCommentProfile(marker: Buffer, payload: Buffer) {
	const value = Buffer.concat([marker, payload])
	const profile = Buffer.alloc(6 + 44 + value.length)
	profile.write('Exif\0\0', 0, 'binary')
	const tiff = 6
	profile.write('II', tiff, 'ascii')
	profile.writeUInt16LE(42, tiff + 2)
	profile.writeUInt32LE(8, tiff + 4)
	profile.writeUInt16LE(1, tiff + 8)
	profile.writeUInt16LE(0x8769, tiff + 10)
	profile.writeUInt16LE(4, tiff + 12)
	profile.writeUInt32LE(1, tiff + 14)
	profile.writeUInt32LE(26, tiff + 18)
	profile.writeUInt32LE(0, tiff + 22)
	profile.writeUInt16LE(1, tiff + 26)
	profile.writeUInt16LE(0x9286, tiff + 28)
	profile.writeUInt16LE(7, tiff + 30)
	profile.writeUInt32LE(value.length, tiff + 32)
	profile.writeUInt32LE(44, tiff + 36)
	profile.writeUInt32LE(0, tiff + 40)
	value.copy(profile, tiff + 44)
	return profile
}

afterEach(async () => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})))
})

test.each([
	[1, 1, 1],
	[2, 1, 2],
	[4, 1, 3],
	[8, 2, 6],
	[32, 8, 24],
])('sizes enrichment queues for %i available CPU threads', (parallelism, background, onDemand) => {
	expect(enrichmentQueueConcurrency(parallelism)).toStrictEqual({background, onDemand})
})

test('auto-orients before applying short-edge sizing without upscaling', async () => {
	await generateThumbnailFile('/home/photo.jpg', '/data/thumbnail.webp')

	expect(execa).toHaveBeenCalledOnce()
	expect(execa).toHaveBeenCalledWith('convert', expect.any(Array), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
	})
	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_.slice(arguments_.indexOf('/home/photo.jpg[0]'))).toStrictEqual([
		'/home/photo.jpg[0]',
		'-auto-orient',
		'(',
		'+clone',
		'-thumbnail',
		`${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}^>`,
		'-quality',
		String(THUMBNAIL_QUALITY),
		'-write',
		'webp:/data/thumbnail.webp',
		'+delete',
		')',
		'null:',
	])
})

test('writes every requested rendition from one oriented ImageMagick decode', async () => {
	const outputs = (Object.keys(THUMBNAIL_VARIANTS) as ThumbnailVariant[]).map((variant) => ({
		variant,
		destination: `/data/${variant}.webp`,
	}))
	await generateThumbnailFiles('/home/photo.jpg', outputs)

	expect(execa).toHaveBeenCalledOnce()
	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_.filter((argument) => argument === '/home/photo.jpg[0]')).toHaveLength(1)
	expect(arguments_.filter((argument) => argument === '-auto-orient')).toHaveLength(1)
	expect(arguments_.filter((argument) => argument === '+clone')).toHaveLength(outputs.length)
	for (const {variant, destination} of outputs) {
		const definition = THUMBNAIL_VARIANTS[variant]
		expect(arguments_).toContain(`${definition.width}x${definition.height}^>`)
		expect(arguments_).toContain(`${definition.format}:${destination}`)
	}
})

test('passes a held source descriptor to media subprocesses', async () => {
	await generateThumbnailFile('/home/member/photo.jpg', '/data/thumbnail.webp', 'preview-192-webp-v1', 42)

	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_).toContain('/dev/fd/3[0]')
	expect(execa).toHaveBeenCalledWith(
		'convert',
		expect.any(Array),
		expect.objectContaining({stdio: ['ignore', 'pipe', 'pipe', 42]}),
	)
})

test.each([
	['photo.arw', 'ARW'],
	['photo.cr2', 'CR2'],
	['photo.cr3', 'CR3'],
	['photo.dng', 'DNG'],
	['photo.nef', 'NEF'],
	['photo.orf', 'ORF'],
	['photo.raf', 'RAF'],
	['photo.rw2', 'RW2'],
	['video.360', 'MP4'],
	['video.3gp', '3GP'],
	['video.3g2', '3G2'],
	['video.avi', 'AVI'],
	['video.insv', 'MP4'],
	['video.m4v', 'M4V'],
	['video.mkv', 'MKV'],
	['video.m2ts', 'MPEG'],
	['video.mov', 'MOV'],
	['video.mp4', 'MP4'],
	['video.mpeg', 'MPEG'],
	['video.mpg', 'MPEG'],
	['video.mts', 'MPEG'],
	['video.webm', 'WEBM'],
	['video.wmv', 'WMV'],
])('preserves the %s coder when a held descriptor hides the source extension', async (name, coder) => {
	await generateThumbnailFile(`/home/member/${name}`, '/data/thumbnail.webp', 'preview-192-webp-v1', 42)

	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_).toContain(`${coder}:/dev/fd/3[0]`)
})

test.each(Object.entries(THUMBNAIL_VARIANTS))(
	'uses the registered dimensions and quality for %s',
	async (variant, definition) => {
		await generateThumbnailFile('/home/photo.jpg', '/data/thumbnail.webp', variant as ThumbnailVariant)

		const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
		expect(arguments_).toContain(`${definition.width}x${definition.height}^>`)
		expect(arguments_).toContain(String(definition.quality))
	},
)

test.each(Object.keys(THUMBNAIL_VARIANTS))('round-trips the versioned %s artifact name', (variant) => {
	const identity = {kind: 'content' as const, key: 'ab'.repeat(32), variant: variant as ThumbnailVariant}
	expect(parseThumbnailFilename(thumbnailFilename(identity))).toStrictEqual(identity)
})

test.each([
	['/home/photo%d.jpg', '/home/photo%%d.jpg[0]'],
	['/home/photo*.jpg', String.raw`/home/photo\*.jpg[0]`],
	['/home/photo?.jpg', String.raw`/home/photo\?.jpg[0]`],
	['/home/photo[1].jpg', String.raw`/home/photo\[1\].jpg[0]`],
	[String.raw`/home/back\slash.jpg`, String.raw`/home/back\slash.jpg[0]`],
	[String.raw`/home/back\%d.jpg`, String.raw`/home/back\%%d.jpg[0]`],
	[String.raw`/home/back\?.jpg`, String.raw`/home/back\\\?.jpg[0]`],
	[String.raw`/home/back\\?.jpg`, String.raw`/home/back\\\\\?.jpg[0]`],
	['/home/trailing\\', '/home/trailing\\[0]'],
])('escapes ImageMagick filename expansion syntax in %s', async (source, expected) => {
	await generateThumbnailFile(source, '/data/thumbnail.webp')

	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_).toContain(expected)
})

test('kills the complete ImageMagick process group after a timeout', async () => {
	const timeout = Object.assign(new Error('conversion timed out'), {timedOut: true})
	const conversion = Object.assign(Promise.reject(timeout), {pid: 4321})
	vi.mocked(execa).mockReturnValue(conversion as never)
	const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

	await expect(generateThumbnailFile('/home/video.mp4', '/data/thumbnail.webp')).rejects.toThrow('conversion timed out')
	expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL')
})

test('rejects a FIFO thumbnail source without blocking its hash lane', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-thumbnail-fifo-'))
	temporaryDirectories.push(directory)
	const fifo = nodePath.join(directory, 'camera.jpg')
	await execFileAsync('mkfifo', [fifo])
	const stats = await lstat(fifo, {bigint: true})

	await expect(
		hashFileRevision(fifo, {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
		}),
	).rejects.toThrow('File revision no longer matches the index')
})

test('extracts oriented photo metadata, capture offset, GPS, and Apple live identifier', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-photo-metadata-'))
	temporaryDirectories.push(directory)
	const photo = nodePath.join(directory, 'IMG_0001.heic')
	await writeFile(photo, 'photo')
	vi.mocked(execa).mockResolvedValueOnce(
		photoIdentifyMetadata({
			orientation: 'RightTop',
			originalDate: '2025:08:21 14:03:04',
			originalOffset: '+02:30',
			make: 'Apple',
			model: 'iPhone 16 Pro',
			lens: 'iPhone lens',
			focalLength: '24/1',
			aperture: '18/10',
			exposure: '1/125',
			photographicSensitivity: '100',
			latitude: '13/1, 45/1, 0/1',
			latitudeRef: 'N',
			longitude: '100/1, 30/1, 0/1',
			longitudeRef: 'E',
			altitude: '125/2',
			altitudeRef: '0',
			makerContentIdentifier: 'live-photo-id',
		}) as never,
	)

	await expect(extractMediaMetadata(photo)).resolves.toMatchObject({
		kind: 'photo',
		width: 3024,
		height: 4032,
		takenAtOffsetMinutes: 150,
		cameraMake: 'Apple',
		cameraModel: 'iPhone 16 Pro',
		focalLength: '24mm',
		aperture: 'ƒ/1.8',
		exposure: '1/125',
		iso: 100,
		latitude: 13.75,
		longitude: 100.5,
		altitude: 62.5,
		liveIdentifier: 'live-photo-id',
	})
	expect(execa).toHaveBeenCalledWith('identify', expect.arrayContaining(['-limit', 'memory', '-limit', 'time']), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
	})
})

test.each([
	['modern ISO', {photographicSensitivity: '640'}, 640],
	['legacy ISO', {legacyIso: '320'}, 320],
	['modern ISO precedence', {photographicSensitivity: '800', legacyIso: '200'}, 800],
])('extracts %s', async (_name, values, expected) => {
	vi.mocked(execa).mockResolvedValueOnce(photoIdentifyMetadata(values) as never)
	await expect(extractMediaMetadata('/home/photo.jpg')).resolves.toMatchObject({iso: expected})
})

test('falls back to LibRaw DNG metadata for camera RAW photos', async () => {
	vi.mocked(execa).mockResolvedValueOnce(
		photoIdentifyMetadata({
			dngDate: '2008-01-01T15:29:46+02:30',
			dngMake: 'Sony',
			dngModel: 'DSLR-A700',
			dngLens: '20-200mm f/4-6',
			dngFocalLength: '2e+02 mm',
			dngAperture: '8',
			dngExposure: '1/1e+03',
			dngIso: '2e+02',
			dngLatitude: `13 deg 45' 0" N`,
			dngLongitude: `100 deg 30' 0" E`,
			dngAltitude: '62.5 m',
		}) as never,
	)

	await expect(extractMediaMetadata('/home/photo.arw')).resolves.toMatchObject({
		kind: 'photo',
		takenAt: Date.parse('2008-01-01T15:29:46+02:30'),
		takenAtOffsetMinutes: 150,
		cameraMake: 'Sony',
		cameraModel: 'DSLR-A700',
		lens: '20-200mm f/4-6',
		focalLength: '200mm',
		aperture: 'ƒ/8',
		exposure: '1/1000',
		iso: 200,
		latitude: 13.75,
		longitude: 100.5,
		altitude: 62.5,
	})
})

test('ignores LibRaw zero GPS and unknown-lens sentinels', async () => {
	vi.mocked(execa).mockResolvedValueOnce(
		photoIdentifyMetadata({
			dngDate: '2008-02-30T15:29:46+00:00',
			dngLens: '0-0mm f/0-0',
			dngLatitude: `0 deg 0' 0" N`,
			dngLongitude: `0 deg 0' 0" W`,
			dngAltitude: '0 m',
		}) as never,
	)

	const metadata = await extractMediaMetadata('/home/photo.dng')
	expect(metadata).not.toHaveProperty('takenAt')
	expect(metadata).not.toHaveProperty('lens')
	expect(metadata).not.toHaveProperty('latitude')
	expect(metadata).not.toHaveProperty('longitude')
})

test('prefers EXIF metadata when a DNG exposes both metadata families', async () => {
	vi.mocked(execa).mockResolvedValueOnce(
		photoIdentifyMetadata({
			originalDate: '2025:08:21 14:03:04',
			originalOffset: '+02:30',
			make: 'Apple',
			model: 'iPhone 16 Pro',
			photographicSensitivity: '640',
			dngDate: '2008-01-01T15:29:46+00:00',
			dngMake: 'Raw make',
			dngModel: 'Raw model',
			dngIso: '200',
		}) as never,
	)

	await expect(extractMediaMetadata('/home/photo.dng')).resolves.toMatchObject({
		takenAt: Date.parse('2025-08-21T14:03:04+02:30'),
		cameraMake: 'Apple',
		cameraModel: 'iPhone 16 Pro',
		iso: 640,
	})
})

test.each([
	[
		'DateTimeOriginal and its offset',
		{
			originalDate: '2024:01:02 03:04:05',
			originalOffset: '+02:30',
			digitizedDate: '2023:01:02 03:04:05',
			digitizedOffset: '-04:00',
			dateTime: '2022:01:02 03:04:05',
			dateTimeOffset: '+05:00',
		},
		Date.UTC(2024, 0, 2, 0, 34, 5),
		150,
	],
	[
		'DateTimeDigitized and its offset',
		{digitizedDate: '2023:02:03 04:05:06', digitizedOffset: '-04:00', dateTime: '2022:01:02 03:04:05'},
		Date.UTC(2023, 1, 3, 8, 5, 6),
		-240,
	],
	[
		'DateTime and its offset',
		{dateTime: '2022:03:04 05:06:07', dateTimeOffset: '+05:45'},
		Date.UTC(2022, 2, 3, 23, 21, 7),
		345,
	],
	[
		'a capture date without an offset as UTC',
		{originalDate: '2021:04:05 06:07:08'},
		Date.UTC(2021, 3, 5, 6, 7, 8),
		undefined,
	],
] as const)('selects %s', async (_name, values, takenAt, offsetMinutes) => {
	vi.mocked(execa).mockResolvedValueOnce(photoIdentifyMetadata(values) as never)
	const metadata = await extractMediaMetadata('/home/photo.jpg')
	expect(metadata.takenAt).toBe(takenAt)
	expect(metadata.takenAtOffsetMinutes).toBe(offsetMinutes)
})

test('falls through an invalid higher-priority photo date without borrowing its offset', async () => {
	vi.mocked(execa).mockResolvedValueOnce(
		photoIdentifyMetadata({
			originalDate: '2024:02:30 12:00:00',
			originalOffset: '+09:00',
			digitizedDate: '2023:05:06 07:08:09',
			digitizedOffset: '-03:00',
		}) as never,
	)
	await expect(extractMediaMetadata('/home/photo.jpg')).resolves.toMatchObject({
		takenAt: Date.UTC(2023, 4, 6, 10, 8, 9),
		takenAtOffsetMinutes: -180,
	})
})

test.each([
	['above sea level', '125/2', '0', 62.5],
	['below sea level', '125/2', '1', -62.5],
])('extracts GPS altitude %s', async (_name, altitude, altitudeRef, expected) => {
	vi.mocked(execa).mockResolvedValueOnce(
		photoIdentifyMetadata({
			latitude: '13/1, 45/1, 0/1',
			latitudeRef: 'N',
			longitude: '100/1, 30/1, 0/1',
			longitudeRef: 'E',
			altitude,
			altitudeRef,
		}) as never,
	)
	await expect(extractMediaMetadata('/home/photo.jpg')).resolves.toMatchObject({altitude: expected})
})

test('extracts and normalizes ASCII EXIF UserComment metadata', async () => {
	vi.mocked(execa)
		.mockResolvedValueOnce(photoIdentifyMetadata({userCommentMarker: 'ASCII'}) as never)
		.mockResolvedValueOnce({
			stdout: exifUserCommentProfile(Buffer.from('ASCII\0\0\0', 'binary'), Buffer.from('  Alpine sunrise  \0')),
		} as never)

	await expect(extractMediaMetadata('/home/photo.jpg')).resolves.toMatchObject({userComment: 'Alpine sunrise'})
	expect(execa).toHaveBeenCalledTimes(2)
})

test.each([
	[
		'Unicode with a BOM',
		exifUserCommentProfile(
			Buffer.from('UNICODE\0', 'binary'),
			Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Cafe\u0301 東京の夜\0', 'utf16le')]),
		),
		'Café 東京の夜',
	],
	['empty ASCII', exifUserCommentProfile(Buffer.from('ASCII\0\0\0', 'binary'), Buffer.from('   \0')), undefined],
	['missing', Buffer.from('not an EXIF profile'), undefined],
	[
		'malformed Unicode',
		exifUserCommentProfile(Buffer.from('UNICODE\0', 'binary'), Buffer.from([0xff, 0xfe, 0x00])),
		undefined,
	],
	[
		'unknown character set',
		exifUserCommentProfile(Buffer.from('UNKNOWN\0', 'binary'), Buffer.from('comment')),
		undefined,
	],
] as const)('decodes %s UserComment safely', (_name, profile, expected) => {
	expect(decodeExifUserComment(profile)).toBe(expected)
})

test('extracts descriptor-backed video metadata without passing an ImageMagick coder to ffprobe', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-video-metadata-'))
	temporaryDirectories.push(directory)
	const video = nodePath.join(directory, 'IMG_0001.mov')
	await writeFile(video, 'video')
	vi.mocked(execa)
		.mockResolvedValueOnce({
			stdout: JSON.stringify({
				streams: [
					{
						codec_type: 'video',
						width: 1920,
						height: 1080,
						duration: 'N/A',
						side_data_list: [{rotation: 90}],
						tags: {
							rotate: '0',
							creation_time: '2025-08-21T12:00:00Z',
							projection: 'equirectangular',
							'com.apple.quicktime.content.identifier': 'live-photo-id',
						},
					},
				],
				format: {duration: '3.25'},
			}),
		} as never)
		.mockResolvedValueOnce({stdout: '[{}]'} as never)

	await expect(extractMediaMetadata(video, 42)).resolves.toMatchObject({
		kind: 'video',
		subKind: 'spherical',
		width: 1080,
		height: 1920,
		durationMs: 3250,
		liveIdentifier: 'live-photo-id',
	})
	expect(execa).toHaveBeenNthCalledWith(1, 'ffprobe', expect.arrayContaining(['/dev/fd/3']), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
		stdio: ['ignore', 'pipe', 'pipe', 42],
	})
	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_).not.toContain('MOV:/dev/fd/3')
	expect(execa).toHaveBeenNthCalledWith(2, 'exiftool', expect.arrayContaining(['-G1:2', '/dev/fd/3']), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
		stdio: ['ignore', 'pipe', 'pipe', 42],
	})
	const exifToolArguments = vi.mocked(execa).mock.calls[1]![1] as string[]
	expect(exifToolArguments).toEqual(expect.arrayContaining(['-api', 'IgnoreTags=all']))
	expect(exifToolArguments).not.toContain('-ee')
})

test('merges camera-classified QuickTime metadata without accepting non-camera groups', async () => {
	vi.mocked(execa)
		.mockResolvedValueOnce({
			stdout: JSON.stringify({
				streams: [{codec_type: 'video', width: 1920, height: 1080}],
				format: {duration: '1'},
			}),
		} as never)
		.mockResolvedValueOnce({
			stdout: JSON.stringify([
				{
					'ICC-header:Image:Make': 'Colour profile vendor',
					'ICC-header:Image:Model': 'Colour profile model',
					'Keys:Camera:Make': 'Apple',
					'Keys:Camera:Model': 'iPhone Air',
					'VideoKeys:Camera:LensModel': 'iPhone Air front camera 2.715mm f/1.9',
					'VideoKeys:Camera:FocalLength': 2.715,
					'VideoKeys:Camera:FNumber': 1.9,
					'VideoKeys:Camera:ExposureTime': 0.005,
					'VideoKeys:Camera:ISO': 80,
				},
			]),
		} as never)

	await expect(extractMediaMetadata('/home/iphone.mov')).resolves.toMatchObject({
		cameraMake: 'Apple',
		cameraModel: 'iPhone Air',
		lens: 'iPhone Air front camera 2.715mm f/1.9',
		focalLength: '2.7mm',
		aperture: 'ƒ/1.9',
		exposure: '1/200',
		iso: 80,
	})
})

test('accepts Android camera identity keys from the QuickTime video group', async () => {
	vi.mocked(execa)
		.mockResolvedValueOnce({
			stdout: JSON.stringify({streams: [{codec_type: 'video', width: 1920, height: 1080}]}),
		} as never)
		.mockResolvedValueOnce({
			stdout: JSON.stringify([
				{
					'Keys:Video:AndroidMake': 'Google',
					'Keys:Video:AndroidModel': 'Pixel 10 Pro',
				},
			]),
		} as never)

	await expect(extractMediaMetadata('/home/pixel.mp4')).resolves.toMatchObject({
		cameraMake: 'Google',
		cameraModel: 'Pixel 10 Pro',
	})
})

test('extracts embedded Insta360 trailer metadata only for INSV videos', async () => {
	vi.mocked(execa)
		.mockResolvedValueOnce({
			stdout: JSON.stringify({
				streams: [{codec_type: 'video', width: 1920, height: 1920}],
				format: {duration: '61'},
			}),
		} as never)
		.mockResolvedValueOnce({
			stdout: JSON.stringify([
				{
					'Insta360:Camera:Model': 'Insta360 X4',
					'Insta360:Camera:ExposureTime': 0.00499681429937482,
				},
			]),
		} as never)

	await expect(extractMediaMetadata('/home/video.insv')).resolves.toMatchObject({
		cameraModel: 'Insta360 X4',
		exposure: '1/200',
	})
	const arguments_ = vi.mocked(execa).mock.calls[1]![1] as string[]
	expect(arguments_).toContain('-ee')
})

test('keeps playable video metadata when optional ExifTool extraction fails', async () => {
	const onOptionalMetadataFailure = vi.fn()
	const optionalMetadataError = new Error('Unsupported vendor trailer')
	vi.mocked(execa)
		.mockResolvedValueOnce({
			stdout: JSON.stringify({
				streams: [{codec_type: 'video', width: 1280, height: 720}],
				format: {duration: '2'},
			}),
		} as never)
		.mockRejectedValueOnce(optionalMetadataError)

	await expect(extractMediaMetadata('/home/video.mp4', undefined, onOptionalMetadataFailure)).resolves.toMatchObject({
		kind: 'video',
		width: 1280,
		height: 720,
		durationMs: 2000,
	})
	expect(onOptionalMetadataFailure).toHaveBeenCalledOnce()
	expect(onOptionalMetadataFailure).toHaveBeenCalledWith(optionalMetadataError)
})

test('packs the average thumbnail colour as 0xRRGGBB', async () => {
	vi.mocked(execa).mockResolvedValueOnce({stdout: '18,52,86'} as never)
	await expect(extractThumbnailTint('/data/thumbnail.webp')).resolves.toBe(0x123456)
})
