import {execFile} from 'node:child_process'
import {lstat, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import {promisify} from 'node:util'

import {afterEach, expect, test, vi} from 'vitest'

import {execa} from 'execa'

import {THUMBNAIL_HEIGHT, THUMBNAIL_QUALITY, THUMBNAIL_WIDTH} from './thumbnail-support.js'
import {generateThumbnailFile, hashFileRevision, THUMBNAIL_GENERATION_TIMEOUT_MS} from './file-index-enrichment.js'

vi.mock('execa')

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})))
})

test('auto-orients before resizing the source image', async () => {
	await generateThumbnailFile('/home/photo.jpg', '/data/thumbnail.webp')

	expect(execa).toHaveBeenCalledOnce()
	expect(execa).toHaveBeenCalledWith('convert', expect.any(Array), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
	})
	const arguments_ = vi.mocked(execa).mock.calls[0][1] as string[]
	expect(arguments_).not.toContain('-thumbnail')
	expect(arguments_.slice(arguments_.indexOf('/home/photo.jpg[0]'))).toStrictEqual([
		'/home/photo.jpg[0]',
		'-auto-orient',
		'-resize',
		`${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}`,
		'-quality',
		String(THUMBNAIL_QUALITY),
		'webp:/data/thumbnail.webp',
	])
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
			ctimeNs: stats.ctimeNs.toString(),
		}),
	).rejects.toThrow('File revision no longer matches the index')
})
