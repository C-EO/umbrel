import {once} from 'node:events'
import type {AddressInfo} from 'node:net'

import cookieParser from 'cookie-parser'
import express from 'express'
import got from 'got'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import type Umbreld from '../../index.js'
import {OWNER_ACCOUNT_ID} from '../auth/auth.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import fileApi from './api.js'

describe('file API authentication boundaries', () => {
	const directory = temporaryDirectory()
	let server: ReturnType<express.Express['listen']>
	let origin: string

	beforeAll(async () => {
		await directory.createRoot()
		const thumbnailDirectory = await directory.create()
		const uploadDirectory = await directory.create()
		const systemPrincipal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'} as const
		const umbreld = {
			auth: {
				authenticateDashboardCredentials: async (token: string) => {
					if (token !== 'system-token') throw new Error('Invalid credential')
					return systemPrincipal
				},
				authenticate: async (token: string, audience: string) => {
					if (token !== 'system-token' || audience !== 'dashboard') throw new Error('Invalid credential')
					return systemPrincipal
				},
				authorizeHttpApi: async () => systemPrincipal,
			},
			files: {
				thumbnails: {thumbnailDirectory},
				virtualToSystemPath: async () => `${uploadDirectory}/blocked.txt`,
				authorizeWritableDestinationSystemPath: async () => {
					throw new Error('[cloud-read-only]')
				},
			},
		} as unknown as Umbreld

		const app = express()
		app.use(cookieParser())
		app.use('/api/files', fileApi(umbreld))
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	test.each([
		['GET', '/api/files/thumbnail/missing'],
		['GET', '/api/files/download'],
		['GET', '/api/files/view'],
		['POST', '/api/files/upload'],
		['GET', '/api/files/future-route-without-an-auth-policy'],
	] as const)('%s %s is denied before its file handler runs', async (method, path) => {
		const response = await got(`${origin}${path}`, {method, throwHttpErrors: false})
		expect(response.statusCode).toBe(401)
	})

	test('even a valid credential cannot reach a route without an explicit auth policy', async () => {
		const response = await got(`${origin}/api/files/future-route-without-an-auth-policy`, {
			headers: {Authorization: 'Bearer system-token'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(401)
	})

	test.each([
		['GET', '/api/files/thumbnail/missing', 404],
		['GET', '/api/files/download', 400],
		['GET', '/api/files/view', 400],
		['POST', '/api/files/upload', 400],
	] as const)('the local system credential can reach %s %s', async (method, path, statusCode) => {
		const response = await got(`${origin}${path}`, {
			method,
			headers: {Authorization: 'Bearer system-token'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(statusCode)
	})

	test('upload preserves the Cloud read-only policy error', async () => {
		const response = await got(`${origin}/api/files/upload?path=${encodeURIComponent('/Home/Cloud/blocked.txt')}`, {
			method: 'POST',
			headers: {Authorization: 'Bearer system-token'},
			body: 'blocked',
			throwHttpErrors: false,
		})

		expect(response.statusCode).toBe(400)
		expect(JSON.parse(response.body)).toEqual({error: '[cloud-read-only]'})
	})
})
