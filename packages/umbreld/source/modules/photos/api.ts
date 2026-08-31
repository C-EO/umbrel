// Photos HTTP endpoints. The client derives every URL from content-hash item ids
// (API responses carry no media URL fields):
//
//   GET  /api/photos/thumb/:id?s=192|512|1280
//   GET  /api/photos/original/:id[?download]
//   GET  /api/photos/live/:id
//   GET  /api/photos/download?ticket=…
//   POST /api/photos/upload?name=IMG_1234.jpg&album=<id>
//
import nodePath from 'node:path'
import {pipeline} from 'node:stream/promises'

import express from 'express'
import mime from 'mime-types'

import type Umbreld from '../../index.js'
import type {Principal} from '../auth/auth.js'
import {authorizeDashboardRequest, authorizeHttpRequest} from '../auth/http-request.js'
import {receiveUpload} from '../files/api.js'
import type UploadDiskPreflight from '../server/upload-disk-preflight.js'
import type {ThumbnailVariant} from '../files/thumbnail-support.js'
import {OWNER_USER_ID} from '../user/constants.js'

import {supportsPhotos} from './types.js'

const THUMB_VARIANTS: Record<string, ThumbnailVariant> = {
	'192': 'preview-192-webp-v1',
	'512': 'preview-512-webp-v2',
	'1280': 'preview-1280-webp-v2',
}

function accountId(response: express.Response) {
	const principal = response.locals.principal as Principal | undefined
	if (!principal) throw new Error('Missing authenticated principal')
	return principal.accountId
}

function uploadDirectoryForAccount(id: string) {
	return id === OWNER_USER_ID ? '/Home/Photos' : `/Users/${id}/Photos`
}

function requestedByteRange(header: string | undefined, size: number) {
	if (!header) return {start: 0, end: Math.max(0, size - 1), partial: false} as const
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (!match || size === 0) return
	const [, startText, endText] = match
	if (!startText && !endText) return
	let start: number
	let end: number
	if (!startText) {
		const suffixLength = Number(endText)
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return
		start = Math.max(0, size - suffixLength)
		end = size - 1
	} else {
		start = Number(startText)
		end = endText ? Number(endText) : size - 1
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return
		end = Math.min(end, size - 1)
	}
	return {start, end, partial: true} as const
}

export default function api(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight) {
	const api = express.Router()

	// Deny-by-default, like Files' router: adding a handler below also requires
	// an explicit policy here. Media GETs use the URL-token authorization (an
	// <img>/<video> can't send headers); upload keeps the dashboard session.
	api.use((request, response, next) => {
		const path = request.path.replace(/\/+$/, '') || '/'
		let authorization: Promise<Principal> | undefined
		if (request.method === 'GET' && path.startsWith('/thumb/')) {
			authorization = authorizeHttpRequest(umbreld, request, 'file-thumbnail', path)
		} else if (request.method === 'GET' && (path.startsWith('/original/') || path.startsWith('/live/'))) {
			authorization = authorizeHttpRequest(umbreld, request, 'file-view', path)
		} else if (request.method === 'GET' && path === '/download') {
			authorization = authorizeHttpRequest(umbreld, request, 'file-download', path)
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
	})

	// Resolve the account-scoped content hash, then re-authorize the current
	// virtual path at the Files boundary before touching the original.
	async function resolveItemId(id: string, response: express.Response) {
		const item = await umbreld.photos.resolveItem(accountId(response), id)
		if (!item) throw new Error('[photos-item-not-found]')
		return {virtualPath: item.path}
	}

	function resolveItem(request: express.Request, response: express.Response) {
		return resolveItemId(String(request.params.id), response)
	}

	async function streamAuthorizedFile(
		virtualPath: string,
		request: express.Request,
		response: express.Response,
		{download = false}: {download?: boolean} = {},
	) {
		const file = await umbreld.files.openFileForRead(virtualPath, accountId(response))
		try {
			const size = Number(file.stats.size)
			const range = requestedByteRange(request.get('Range'), size)
			if (!range) {
				response.setHeader('Content-Range', `bytes */${size}`)
				return response.status(416).end()
			}
			response.setHeader('Accept-Ranges', 'bytes')
			response.setHeader('Content-Length', String(size === 0 ? 0 : range.end - range.start + 1))
			response.setHeader('Last-Modified', new Date(Number(file.stats.mtimeMs)).toUTCString())
			if (download) {
				response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
				response.setHeader('Content-Type', 'application/octet-stream')
			} else {
				response.setHeader('Content-Type', mime.lookup(file.name) || 'application/octet-stream')
			}
			if (range.partial) {
				response.status(206)
				response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
			}
			if (size === 0) return response.end()
			await pipeline(file.handle.createReadStream({autoClose: false, start: range.start, end: range.end}), response)
		} finally {
			await file.handle.close().catch(() => {})
		}
	}

	// GET /api/photos/thumb/:id?s=192|512|1280 — content-addressed renditions,
	// generated in the background or promoted through the on-demand lane.
	api.get('/thumb/:id', async (request, response) => {
		try {
			const s = String(request.query.s ?? '')
			const variant = THUMB_VARIANTS[s]
			if (!variant) return response.status(400).json({error: 'invalid s parameter'})
			const {virtualPath} = await resolveItem(request, response)
			response.setHeader('Cache-Control', 'private, no-cache')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			const thumbnailUrl = await umbreld.files.thumbnails.getThumbnailOnDemand(
				virtualPath,
				accountId(response),
				variant,
			)
			const filename = nodePath.posix.basename(new URL(thumbnailUrl, 'http://localhost').pathname)
			const thumbnailSystemPath = await umbreld.files.thumbnails.resolveThumbnailRequest(
				filename,
				virtualPath,
				accountId(response),
			)
			return response.sendFile(thumbnailSystemPath, {cacheControl: false, dotfiles: 'deny'})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/original/:id — the original bytes, including video ranges.
	// `?download` switches to attachment disposition.
	api.get('/original/:id', async (request, response) => {
		try {
			const {virtualPath} = await resolveItem(request, response)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			response.setHeader(
				'Content-Security-Policy',
				"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
			)
			return await streamAuthorizedFile(virtualPath, request, response, {
				download: request.query.download !== undefined,
			})
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/live/:id — the motion companion for an indexed Apple
	// live pair. The companion path is independently re-authorized.
	api.get('/live/:id', async (request, response) => {
		try {
			const companion = await umbreld.photos.resolveLiveCompanion(accountId(response), String(request.params.id))
			if (!companion) throw new Error('[photos-live-not-found]')
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return await streamAuthorizedFile(companion.path, request, response)
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	// GET /api/photos/download?ticket=… — the ticket contains one or more
	// account-bound item ids and is short-lived and single-use. One item is sent
	// as an attachment; several become a flat zip stream. Each id is translated
	// to a currently-authorized filesystem path at request time, and duplicate
	// basenames are disambiguated in the archive.
	api.get('/download', async (request, response) => {
		try {
			if (typeof request.query.ticket !== 'string') return response.status(400).json({error: 'bad request'})
			const ids = umbreld.photos.consumeDownloadTicket(accountId(response), request.query.ticket)
			if (!ids) return response.status(404).json({error: 'not found'})
			const items = await Promise.all(ids.map((id) => resolveItemId(String(id), response)))
			if (items.length === 1) {
				response.setHeader('X-Content-Type-Options', 'nosniff')
				return await streamAuthorizedFile(items[0]!.virtualPath, request, response, {download: true})
			}
			response.setHeader('Content-Type', 'application/zip')
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''umbrel-photos.zip`)
			await pipeline(
				await umbreld.files.archive.createAuthorizedFlatFileZipStream(
					items.map(({virtualPath}) => virtualPath),
					accountId(response),
				),
				response,
			)
		} catch {
			if (!response.headersSent) response.status(404).json({error: 'not found'})
		}
	})

	// POST /api/photos/upload?name=IMG_1234.jpg&album=a-iceland — body = the
	// bytes, one file per request. Bytes land in the current account's Photos
	// directory through Files' hardened upload primitive (temp file,
	// keep-both collisions, ownership).
	// 2xx answers {status: 'imported' | 'duplicate'}; unsupported types → 415.
	api.post('/upload', async (request, response) => {
		// `Connection: close` on early errors so the browser doesn't stream the
		// whole body before reading the verdict (see Files' uploadFile)
		const name = typeof request.query.name === 'string' ? nodePath.basename(request.query.name) : ''
		const albumId = typeof request.query.album === 'string' ? request.query.album : undefined
		if (!name) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'name is required'})
		}
		if (!supportsPhotos(name)) {
			response.setHeader('Connection', 'close')
			return response.status(415).json({error: 'unsupported file type'})
		}
		if (albumId && !(await umbreld.photos.listAlbums(accountId(response))).some(({id}) => id === albumId)) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: '[photos-album-not-found]'})
		}
		try {
			const id = accountId(response)
			let importStatus: 'imported' | 'duplicate' | undefined
			const upload = await receiveUpload(umbreld, uploadDiskPreflight, request, response, {
				virtualPath: `${uploadDirectoryForAccount(id)}/${name}`,
				collision: 'keep-both',
				calculateBlake3: true,
				onBeforePublish: async (blake3) => {
					const status = await umbreld.photos.prepareUpload(id, blake3, albumId)
					if (status === 'duplicate') {
						importStatus = status
						return 'skip'
					}
					return 'publish'
				},
				onPublished: async (published) => {
					if (!published.blake3) throw new Error('Missing upload hash')
					importStatus = await umbreld.photos.registerUpload(
						id,
						published.systemPath,
						published.blake3,
						published.revision,
						albumId,
					)
				},
			})
			if (!upload) return
			if (!importStatus) throw new Error('Photos import did not complete')
			return response.status(200).json({status: importStatus})
		} catch {
			// receiveUpload answers byte-transfer errors; this guards import
			// bookkeeping (for example, an album deleted mid-upload). Once bytes
			// are published they remain filesystem-authoritative so index recovery
			// can discover them without a pathname-based rollback race.
			if (!response.headersSent) response.status(500).json({error: 'upload failed'})
		}
	})

	return api
}
