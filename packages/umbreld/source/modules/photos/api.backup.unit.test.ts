import {once} from 'node:events'
import type {AddressInfo} from 'node:net'

import express from 'express'
import fse from 'fs-extra'
import got from 'got'
import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import UploadDiskPreflight from '../server/upload-disk-preflight.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import photoApi from './api.js'

type FileWriteFailureCode = 'ENOSPC' | 'EDQUOT' | 'EIO'

const fileWriteFailure = vi.hoisted(() => ({code: undefined as FileWriteFailureCode | undefined}))
const fileDurability = vi.hoisted(() => ({syncedPaths: [] as string[], failSyncPath: undefined as string | undefined}))

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>()
	const {Writable} = await import('node:stream')
	const originalOpen = original.open
	return {
		...original,
		open: async (...args: Parameters<typeof originalOpen>) => {
			const file = await originalOpen(...args)
			const path = String(args[0])
			const code = fileWriteFailure.code
			if (!code) {
				const sync = file.sync.bind(file)
				file.sync = async () => {
					fileDurability.syncedPaths.push(path)
					if (fileDurability.failSyncPath === path) throw Object.assign(new Error('EIO'), {code: 'EIO'})
					await sync()
				}
				return file
			}
			await file.close()
			return {
				createWriteStream: () =>
					new Writable({
						write(_chunk, _encoding, callback) {
							callback(Object.assign(new Error(code), {code}))
						},
					}),
				close: async () => {},
			} as unknown as typeof file
		},
	}
})

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_KEY = 'a'.repeat(64)

describe('photo backup API', () => {
	const directory = temporaryDirectory()
	const source = {id: SOURCE_ID, accountId: '0', name: 'Pixel 9', createdAt: 1}
	const touchSession = vi.fn(async () => true)
	let availableBytes = Number.MAX_SAFE_INTEGER
	let mediaDirectory: string
	let server: ReturnType<express.Express['listen']>
	let origin: string

	beforeAll(async () => {
		await directory.createRoot()
		mediaDirectory = await directory.create()
		const auth = {
			authenticatePhotoBackupGrant: async (token: string) => {
				if (token === 'photo-grant') {
					return {sessionId: 'native-session', accountId: '0', actor: 'account' as const, sourceId: SOURCE_ID}
				}
				throw new Error('Invalid credential')
			},
			touchSession,
		}
		const photos = {backupSourceMediaDirectory: () => `${mediaDirectory}/${source.accountId}/${source.id}`}
		const umbreld = {
			auth,
			photos,
			logger: {error: vi.fn()},
		} as unknown as Umbreld
		const uploadDiskPreflight = new UploadDiskPreflight({
			getAvailableBytes: async () => availableBytes,
			reserveBytes: 0,
		})
		const app = express()
		app.use('/api/photos', photoApi(umbreld, uploadDiskPreflight))
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	beforeEach(() => {
		availableBytes = Number.MAX_SAFE_INTEGER
		fileWriteFailure.code = undefined
		fileDurability.syncedPaths = []
		fileDurability.failSyncPath = undefined
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	function upload(resourceKey: string, fileExtension: string, body: string) {
		return got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': resourceKey,
				'X-Umbrel-Photo-Backup-Extension': fileExtension,
			},
			body,
			throwHttpErrors: false,
		})
	}

	async function expectNoUploadArtifacts(resourceKey: string) {
		const sourceDirectory = `${mediaDirectory}/0/${SOURCE_ID}`
		await vi.waitFor(async () => {
			const entries = (await fse.pathExists(sourceDirectory)) ? await fse.readdir(sourceDirectory) : []
			expect(entries.some((name) => name.includes(resourceKey))).toBe(false)
		})
	}

	test('answers the unauthenticated PhotoKit capability probe with 501', async () => {
		const response = await got(`${origin}/api/photos/upload`, {method: 'OPTIONS', throwHttpErrors: false})
		expect(response.statusCode).toBe(501)
	})

	test.each([
		['POST', '/api/photos/upload'],
		['GET', '/api/photos/future-route'],
	] as const)('%s %s is denied before its handler runs', async (method, path) => {
		const response = await got(`${origin}${path}`, {method, throwHttpErrors: false})
		expect(response.statusCode).toBe(401)
	})

	test('distinguishes invalid upload metadata from an invalid grant', async () => {
		const invalidMetadata = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': 'not-a-resource-key',
				'X-Umbrel-Photo-Backup-Extension': 'heic',
			},
			body: 'photo',
			throwHttpErrors: false,
		})
		expect(invalidMetadata.statusCode).toBe(400)

		const invalidGrant = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer invalid-grant',
				'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
			},
			body: 'photo',
			throwHttpErrors: false,
		})
		expect(invalidGrant.statusCode).toBe(401)
	})

	test('derives a private source path and atomically replaces idempotent retries', async () => {
		const upload = (body: string) =>
			got(`${origin}/api/photos/upload?path=/Home/ignored.jpg`, {
				method: 'POST',
				headers: {
					Authorization: 'Bearer photo-grant',
					'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
					'X-Umbrel-Photo-Backup-Extension': 'HEIC',
				},
				body,
			})

		const first = await upload('first photo')
		const retry = await upload('replacement photo')
		const receiptPath = `${SOURCE_ID}/${RESOURCE_KEY}.heic`
		const systemPath = `${mediaDirectory}/0/${receiptPath}`

		expect(first.headers['x-umbrel-photo-backup-key']).toBe(RESOURCE_KEY)
		expect(first.headers['x-umbrel-upload-path']).toBe(receiptPath)
		expect(retry.headers['x-umbrel-upload-bytes']).toBe(String(Buffer.byteLength('replacement photo')))
		await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('replacement photo')
		expect((await fse.stat(systemPath)).mode & 0o777).toBe(0o600)
		expect((await fse.stat(`${mediaDirectory}/0/${SOURCE_ID}`)).mode & 0o777).toBe(0o700)
		expect(fileDurability.syncedPaths.filter((path) => path.endsWith('.umbrel-upload'))).toHaveLength(2)
		expect(fileDurability.syncedPaths.filter((path) => path === `${mediaDirectory}/0/${SOURCE_ID}`)).toHaveLength(2)
		expect(
			(await fse.readdir(`${mediaDirectory}/0/${SOURCE_ID}`)).filter((name) => name.endsWith('.umbrel-upload')),
		).toEqual([])
		expect(touchSession).toHaveBeenCalledWith(
			expect.objectContaining({sessionId: 'native-session', accountId: '0', sourceId: SOURCE_ID}),
		)
	})

	test('withholds the receipt when the final directory entry cannot be synced', async () => {
		const resourceKey = 'f'.repeat(64)
		const sourceDirectory = `${mediaDirectory}/0/${SOURCE_ID}`
		fileDurability.failSyncPath = sourceDirectory

		const response = await upload(resourceKey, 'heic', 'photo')

		expect(response.statusCode).toBe(500)
		expect(fileDurability.syncedPaths.some((path) => path.endsWith('.umbrel-upload'))).toBe(true)
		expect(fileDurability.syncedPaths).toContain(sourceDirectory)
		await expect(fse.readFile(`${sourceDirectory}/${resourceKey}.heic`, 'utf8')).resolves.toBe('photo')
	})

	test('rejects an upload before writing when it cannot fit', async () => {
		availableBytes = 1
		const resourceKey = 'b'.repeat(64)
		const response = await upload(resourceKey, 'mov', 'too large')

		expect(response.statusCode).toBe(507)
		expect(response.headers['x-umbrel-photo-backup-error']).toBe('insufficient-storage')
		expect(response.headers.connection).not.toBe('close')
		expect(JSON.parse(response.body)).toEqual({error: '[not-enough-space]'})
		await expectNoUploadArtifacts(resourceKey)
	})

	test.each(['ENOSPC', 'EDQUOT'] as const)('labels a mid-upload %s and removes the partial file', async (code) => {
		const resourceKey = code === 'ENOSPC' ? 'c'.repeat(64) : 'd'.repeat(64)
		fileWriteFailure.code = code
		const response = await upload(resourceKey, 'heic', 'photo')

		expect(response.statusCode).toBe(507)
		expect(response.headers['x-umbrel-photo-backup-error']).toBe('insufficient-storage')
		expect(JSON.parse(response.body)).toEqual({error: '[not-enough-space]'})
		await expectNoUploadArtifacts(resourceKey)
	})

	test('does not label unrelated filesystem failures as insufficient storage', async () => {
		const resourceKey = 'e'.repeat(64)
		fileWriteFailure.code = 'EIO'
		const response = await upload(resourceKey, 'heic', 'photo')

		expect(response.statusCode).toBe(500)
		expect(response.headers['x-umbrel-photo-backup-error']).toBeUndefined()
		expect(JSON.parse(response.body)).toEqual({error: 'error writing photo backup'})
		await expectNoUploadArtifacts(resourceKey)
	})
})
