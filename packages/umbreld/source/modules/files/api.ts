import {randomBytes} from 'node:crypto'
import {constants} from 'node:fs'
import {open} from 'node:fs/promises'
import nodePath from 'node:path'
import {pipeline} from 'node:stream/promises'

import express from 'express'
import fse from 'fs-extra'
import mime from 'mime-types'

import type Umbreld from '../../index.js'
import type {Principal} from '../auth/auth.js'
import {authorizeDashboardRequest, authorizeHttpRequest} from '../auth/http-request.js'
import type UploadDiskPreflight from '../server/upload-disk-preflight.js'

// Only allow file types that are safe to preview inline from a same-origin user-controlled endpoint.
const inlineViewMimeTypes = new Set([
	'text/plain',
	'application/pdf',
	'image/avif',
	'image/bmp',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/vnd.microsoft.icon',
	'image/webp',
	'audio/aac',
	'audio/aacp',
	'audio/flac',
	'audio/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/webm',
	'audio/x-caf',
	'audio/x-flac',
	'audio/x-m4a',
	'audio/x-wav',
	'video/mp4',
	'video/mpeg',
	'video/ogg',
	'video/quicktime',
	'video/webm',
	'video/x-m4v',
])

const embedOnlyInlineViewMimeTypes = new Set([
	// SVG is safe to render as an image, but unsafe as a same-origin document.
	'image/svg+xml',
])

function acceptsEmbeddedSvg(request: express.Request) {
	const fetchDest = request.get('Sec-Fetch-Dest')
	if (fetchDest) return fetchDest === 'image'

	const acceptHeader = request.get('Accept') ?? ''
	const acceptedMimeTypes = acceptHeader
		.split(',')
		.map((type) => type.split(';')[0]?.trim().toLowerCase())
		.filter(Boolean)
	const explicitlyAcceptsSvg = acceptedMimeTypes.includes('image/svg+xml') || acceptedMimeTypes.includes('image/*')
	const acceptsDocument = acceptedMimeTypes.includes('text/html') || acceptedMimeTypes.includes('application/xhtml+xml')

	return explicitlyAcceptsSvg && !acceptsDocument
}

function virtualPaths(request: express.Request) {
	if (typeof request.query.path === 'string') return [request.query.path]
	if (Array.isArray(request.query.path)) return request.query.path.map(String)
	return []
}

function accountId(response: express.Response) {
	const principal = response.locals.principal as Principal | undefined
	if (!principal) throw new Error('Missing authenticated principal')
	return principal.accountId
}

function requireFileApiAuth(umbreld: Umbreld) {
	return (request: express.Request, response: express.Response, next: express.NextFunction) => {
		const path = request.path.replace(/\/+$/, '') || '/'
		let authorization: Promise<Principal> | undefined

		// This router is deny-by-default. Adding a handler below also requires an
		// explicit policy here, so a future endpoint cannot accidentally be public.
		if (request.method === 'GET' && (path === '/thumbnail' || path.startsWith('/thumbnail/'))) {
			authorization = authorizeHttpRequest(
				umbreld,
				request,
				'file-thumbnail',
				typeof request.query.path === 'string' ? request.query.path : undefined,
			)
		} else if (request.method === 'GET' && path === '/download') {
			authorization = authorizeHttpRequest(umbreld, request, 'file-download', JSON.stringify(virtualPaths(request)))
		} else if (request.method === 'GET' && path === '/view') {
			authorization = authorizeHttpRequest(
				umbreld,
				request,
				'file-view',
				typeof request.query.path === 'string' ? request.query.path : undefined,
			)
		} else if (request.method === 'POST' && path === '/upload') {
			authorization = authorizeDashboardRequest(umbreld, request)
		}

		if (!authorization) return response.status(401).json({error: 'unauthorized'})

		authorization
			.then((principal) => {
				response.locals.principal = principal
				next()
			})
			.catch(() => response.status(401).json({error: 'unauthorized'}))
	}
}

export function downloadFiles(umbreld: Umbreld) {
	return async (request: express.Request, response: express.Response) => {
		// Normalise a single path or multiple paths into an array
		const requestedPaths = virtualPaths(request)
		// Check that at least one path is provided
		if (requestedPaths.length < 1) return response.status(400).json({error: 'bad request'})

		// Get file data
		const files = await Promise.all(
			requestedPaths.map(async (path) => {
				try {
					const systemPath = await umbreld.files.virtualToSystemPath(path, accountId(response))
					// This means a file doesn't exist (or can't be safely resolved) so we return a 404
					if (!(await fse.exists(systemPath))) throw new Error('not found')
					return systemPath
				} catch (error) {
					response.status(404).json({error: 'not found'})
					throw error
				}
			}),
		)

		// If we only have a single file, serve it directly
		if (files.length === 1 && (await fse.stat(files[0])).isFile()) {
			const filename = nodePath.basename(files[0])
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			response.setHeader('Content-Type', 'application/octet-stream')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return response.sendFile(files[0], {dotfiles: 'allow'})
		}

		// For directory or multiple files, create zip archive
		// Create an archive and stream it to the response
		try {
			const filename = umbreld.files.archive.zipName(files, {defaultName: 'umbrel-files.zip'})
			response.setHeader('Content-Type', 'application/zip')
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			await pipeline(await umbreld.files.archive.createZipStream(files), response)
		} catch (error) {
			if ((error as Error).message === 'paths must be in same directory') {
				return response.status(400).json({error: (error as Error).message})
			}
			throw error
		}
	}
}

export function uploadFile(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight) {
	return async (request: express.Request, response: express.Response) => {
		// Note: We must set the `Connection: close` header on error to prevent the XHR upload logic
		// from uploading the entire file before checking for errors in the response. cURL handles this
		// without the extra header, I'm not sure why it's only needed in the browser.
		// Check we have a path
		if (typeof request.query.path !== 'string') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'path is required'})
		}

		// Get the collision strategy
		const collision = typeof request.query.collision === 'string' ? request.query.collision : 'error'
		if (!['error', 'keep-both', 'replace'].includes(collision)) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid collision parameter'})
		}

		let systemPath: string
		try {
			// Check path is valid
			systemPath = await umbreld.files.virtualToSystemPath(request.query.path, accountId(response))

			// Handle name conflicts
			if (await fse.pathExists(systemPath)) {
				if (collision === 'error') {
					response.setHeader('Connection', 'close')
					return response.status(400).json({error: '[destination-already-exists]'})
				} else if (collision === 'keep-both') {
					// For 'keep-both' we generate a unique name for the file
					systemPath = await umbreld.files.getUniqueName(systemPath)
				} else {
					// For 'replace' we simply continue with the upload over the original file
				}
			}

			// Keep-both can move the upload to a sibling outside a narrow share,
			// while replace must not bypass protected-path deletion rules.
			systemPath = await umbreld.files.authorizeWritableDestinationSystemPath(systemPath, accountId(response), {
				replace: collision === 'replace',
			})
		} catch (error) {
			response.setHeader('Connection', 'close')
			// Keep path-resolution and authorization details private, but let the
			// Files client explain why an otherwise accessible Cloud mirror is read-only.
			const safeError = error instanceof Error && error.message === '[cloud-read-only]' ? error.message : 'invalid path'
			return response.status(400).json({error: safeError})
		}

		// TODO: Implement resume support

		// Temporary file to store the uploaded data
		// We do this to avoid ending up with partially uploaded files of the correct name.
		// It's clear that a partially uploaded file with the .umbrel-upload suffix is not a
		// completed upload.
		// It also sets the groundwork for resuming uploads in the future.
		// It also means that fs change events during upload are fired for
		// .somefile.jpg.umbrel-upload not somefile.jpg so we don't trigger loads of
		// thumbnail generation attempts (matching the .jpg suffix) until the file is fully uploaded.
		// Using a dotfile also automatically hides these temporary files from most file listings
		const fileName = nodePath.basename(systemPath)
		const directory = nodePath.dirname(systemPath)
		const temporarySystemPath = nodePath.join(
			directory,
			`.${fileName}.${randomBytes(16).toString('hex')}.umbrel-upload`,
		)

		// Reject before writing a byte when the upload can't fit. External and
		// network destinations are separate mounts, while unknown-length requests
		// retain the mid-write failure path. Admission is serialized and reserves
		// each upload exactly once from a stable batch snapshot.
		const contentLength = Number(request.headers['content-length'])
		const destinationVirtualPath = umbreld.files.systemToVirtualPath(systemPath)
		const preflighted =
			umbreld.files.isInternalStorageVirtualPath(destinationVirtualPath) &&
			Number.isFinite(contentLength) &&
			contentLength >= 0
		let admitted = true
		if (preflighted) {
			try {
				admitted = await uploadDiskPreflight.admit(temporarySystemPath, contentLength)
			} catch (error) {
				response.setHeader('Connection', 'close')
				throw error
			}
		}
		if (!admitted) {
			return response.status(507).json({error: '[not-enough-space]'})
		}

		let promoted = false
		try {
			await fse.ensureDir(directory)
			let temporaryFile: Awaited<ReturnType<typeof open>> | undefined
			try {
				// Write the file
				// Never open a predictable path or follow a pre-existing link. Archive
				// extraction can create symlinks, and umbreld writes uploads as root.
				temporaryFile = await open(
					temporarySystemPath,
					constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
					0o600,
				)
				const writeStream = temporaryFile.createWriteStream()
				// The stream now owns and closes the descriptor. Keep the handle
				// only until ownership transfers so early setup failures still close it.
				temporaryFile = undefined
				await pipeline(request, writeStream)
			} catch {
				// Return an error
				response.setHeader('Connection', 'close')
				return response.status(500).json({error: 'error writing file'})
			} finally {
				await temporaryFile?.close().catch(() => {})
			}

			// Rename the temporary file to the final path
			await fse.rename(temporarySystemPath, systemPath)
			promoted = true
			// Set owner to the umbrel user
			// We do nothing on fail because this isn't supported on all filesystems.
			// e.g this is expected to throw on external exFAT drives.
			await umbreld.files.chownSystemPath(systemPath).catch(() => {})
			// Return success
			return response.status(200).json({path: umbreld.files.systemToVirtualPath(systemPath)})
		} finally {
			// Restore reserved capacity only after a failed upload's temporary
			// file is confirmed gone.
			let restoreCapacity = false
			if (!promoted) {
				try {
					await fse.remove(temporarySystemPath)
					restoreCapacity = true
				} catch {
					// Keep the reservation because the partial file may remain.
				}
			}
			if (preflighted) await uploadDiskPreflight.release(temporarySystemPath, {restoreCapacity})
		}
	}
}

export default function api(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight) {
	const api = express.Router()
	api.use(requireFileApiAuth(umbreld))

	// Serve thumbnails from the thumbnails directory
	// GET /api/files/thumbnail/:thumbnail
	// Serve the thumbnail assets
	// Thumbnail assets are named with a hash that only changes when the file is modified
	// so a browser can cache them for the session without a shared cache retaining private data.
	// A thumbnail is served only while this account can still resolve its source
	// path. Revalidation keeps revocations effective while the hash remains the
	// stable cache key for unchanged content.
	api.get('/thumbnail/:thumbnail', async (request, response) => {
		try {
			if (typeof request.query.path !== 'string') throw new Error('[thumbnail-not-found]')
			const thumbnailSystemPath = await umbreld.files.thumbnails.resolveThumbnailRequest(
				request.params.thumbnail,
				request.query.path,
				accountId(response),
			)
			response.setHeader('Cache-Control', 'private, no-cache')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return response.sendFile(thumbnailSystemPath, {cacheControl: false, dotfiles: 'deny'})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})
	// Don't serve directory indexes
	// If we don't get a file hit, return a 404
	api.get('/thumbnail', (_request, response) => response.status(404).json({error: 'not found'}))

	// Downloads a file, directory or multiple files
	// GET /api/files/download?path=/Home/file.txt&path=/Home/file-2.txt
	api.get('/download', downloadFiles(umbreld))

	// Views a file
	// GET /api/files/view?path=/Home/file.txt
	api.get('/view', async (request, response) => {
		try {
			if (typeof request.query.path !== 'string') return response.status(400).json({error: 'path is required'})
			const systemPath = await umbreld.files.virtualToSystemPath(request.query.path, accountId(response))
			const status = await umbreld.files.status(systemPath, accountId(response))
			if (status.type === 'directory') return response.status(400).json({error: 'cannot view a directory'})
			response.setHeader(
				'Content-Security-Policy',
				"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
			)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			const mimeType = mime.lookup(systemPath)
			const isImageEmbed = acceptsEmbeddedSvg(request)
			// Files are user-controlled but served same-origin, so only low-risk preview types render inline.
			// All others download, with CSP sandbox and nosniff as defense-in-depth if a browser renders anyway.
			if (
				mimeType &&
				(inlineViewMimeTypes.has(mimeType) || (isImageEmbed && embedOnlyInlineViewMimeTypes.has(mimeType)))
			) {
				response.setHeader('Content-Type', mimeType)
			} else {
				const filename = nodePath.basename(systemPath)
				response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
				response.setHeader('Content-Type', 'application/octet-stream')
			}
			response.sendFile(systemPath, {dotfiles: 'allow'})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// Uploads a file
	// POST /api/files/upload?path=/Home/file.txt&collision=error|keep-both|replace
	api.post('/upload', uploadFile(umbreld, uploadDiskPreflight))
	return api
}
