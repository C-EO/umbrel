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

		// Deny by default: every future route needs an explicit credential policy.
		if (!authorization) return response.status(401).json({error: 'unauthorized'})

		authorization
			.then((principal) => {
				response.locals.principal = principal
				next()
			})
			.catch(() => response.status(401).json({error: 'unauthorized'}))
	}
}

export default function api(umbreld: Umbreld) {
	const api = express.Router()
	api.use(requireFileApiAuth(umbreld))

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
	api.get('/thumbnail', (_request, response) => response.status(404).json({error: 'not found'}))

	api.get('/download', async (request, response) => {
		const requestedPaths = virtualPaths(request)
		if (requestedPaths.length < 1) return response.status(400).json({error: 'bad request'})

		const files = await Promise.all(
			requestedPaths.map(async (path) => {
				try {
					const systemPath = await umbreld.files.virtualToSystemPath(path, accountId(response))
					if (!(await fse.exists(systemPath))) throw new Error('not found')
					return systemPath
				} catch (error) {
					response.status(404).json({error: 'not found'})
					throw error
				}
			}),
		)

		if (files.length === 1 && (await fse.stat(files[0])).isFile()) {
			const filename = nodePath.basename(files[0])
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			response.setHeader('Content-Type', 'application/octet-stream')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return response.sendFile(files[0], {dotfiles: 'allow'})
		}

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
	})

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

	api.post('/upload', async (request, response) => {
		if (typeof request.query.path !== 'string') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'path is required'})
		}

		const collision = typeof request.query.collision === 'string' ? request.query.collision : 'error'
		if (!['error', 'keep-both', 'replace'].includes(collision)) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid collision parameter'})
		}

		let systemPath: string
		try {
			systemPath = await umbreld.files.virtualToSystemPath(request.query.path, accountId(response))

			if (await fse.pathExists(systemPath)) {
				if (collision === 'error') {
					response.setHeader('Connection', 'close')
					return response.status(400).json({error: '[destination-already-exists]'})
				} else if (collision === 'keep-both') {
					systemPath = await umbreld.files.getUniqueName(systemPath)
				}
			}

			// Keep-both can move the upload to a sibling outside a narrow share,
			// while replace must not bypass protected-path deletion rules.
			systemPath = await umbreld.files.authorizeWritableDestinationSystemPath(systemPath, accountId(response), {
				replace: collision === 'replace',
			})
		} catch {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid path'})
		}

		const fileName = nodePath.basename(systemPath)
		const directory = nodePath.dirname(systemPath)
		const temporarySystemPath = nodePath.join(
			directory,
			`.${fileName}.${randomBytes(16).toString('hex')}.umbrel-upload`,
		)
		await fse.ensureDir(directory)

		let promoted = false
		try {
			let temporaryFile: Awaited<ReturnType<typeof open>> | undefined
			try {
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
				response.setHeader('Connection', 'close')
				return response.status(500).json({error: 'error writing file'})
			} finally {
				await temporaryFile?.close().catch(() => {})
			}

			await fse.rename(temporarySystemPath, systemPath)
			promoted = true
			await umbreld.files.chownSystemPath(systemPath).catch(() => {})
			return response.status(200).json({path: umbreld.files.systemToVirtualPath(systemPath)})
		} finally {
			if (!promoted) await fse.remove(temporarySystemPath).catch(() => {})
		}
	})
	return api
}
