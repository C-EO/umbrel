import {readFile} from 'node:fs/promises'

import {afterEach, beforeEach, expect, test} from 'vitest'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let dashboardToken = ''

const credentials = {name: 'satoshi', password: 'moneyprintergobrrr'}

function trpcResult<T>(body: unknown) {
	return (body as {result?: {data?: T}}).result?.data
}

beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.signup()
	dashboardToken = await umbreld.client.user.login.mutate(credentials)
	umbreld.setAuthToken(dashboardToken)
})

afterEach(async () => await umbreld?.cleanup())

test('dashboard tRPC and uploads require the matching token and browser cookie', async () => {
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})

	const tokenOnly = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${dashboardToken}`},
		throwHttpErrors: false,
	})
	expect(tokenOnly.statusCode).toBe(401)

	const cookieOnly = await umbreld.browserApi.get('../trpc/user.get', {throwHttpErrors: false})
	expect(cookieOnly.statusCode).toBe(401)

	const tokenOnlyUpload = await umbreld.unauthenticatedApi.post('files/upload?path=/Home/token-only.txt', {
		body: 'must not upload',
		headers: {Authorization: `Bearer ${dashboardToken}`},
		throwHttpErrors: false,
	})
	expect(tokenOnlyUpload.statusCode).toBe(401)

	await expect(
		umbreld.api.post('files/upload?path=/Home/paired-upload.txt', {body: 'paired upload'}),
	).resolves.toMatchObject({statusCode: 200})
})

test('file reads require the stable file token and matching browser cookie', async () => {
	await umbreld.api.post('files/upload?path=/Home/file-auth.txt', {body: 'private file'})
	const fileToken = await umbreld.client.user.getHttpApiToken.query()
	const path = `files/view?path=${encodeURIComponent('/Home/file-auth.txt')}`

	const paired = await umbreld.browserApi.get(`${path}&token=${fileToken}`, {responseType: 'text'})
	expect(paired.body).toBe('private file')

	const tokenOnly = await umbreld.unauthenticatedApi.get(`${path}&token=${fileToken}`, {throwHttpErrors: false})
	expect(tokenOnly.statusCode).toBe(401)
	const cookieOnly = await umbreld.browserApi.get(path, {throwHttpErrors: false})
	expect(cookieOnly.statusCode).toBe(401)
	const dashboardCredentials = await umbreld.browserApi.get(path, {
		headers: {Authorization: `Bearer ${dashboardToken}`},
		throwHttpErrors: false,
	})
	expect(dashboardCredentials.statusCode).toBe(401)

	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: credentials})
	const secondDashboardToken = trpcResult<string>(secondLogin.body)
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	expect(secondDashboardToken).toBeTypeOf('string')
	expect(secondBrowserCookie).toBeTypeOf('string')
	const secondTokenResponse = await umbreld.unauthenticatedApi.get('../trpc/user.getHttpApiToken', {
		headers: {
			Authorization: `Bearer ${secondDashboardToken}`,
			cookie: secondBrowserCookie!,
		},
	})
	const secondFileToken = trpcResult<string>(secondTokenResponse.body)
	expect(secondFileToken).toBeTypeOf('string')
	const mismatched = await umbreld.browserApi.get(`${path}&token=${secondFileToken}`, {throwHttpErrors: false})
	expect(mismatched.statusCode).toBe(401)

	const renewedDashboardToken = await umbreld.client.user.renewToken.mutate()
	expect(renewedDashboardToken).toBe(dashboardToken)
	umbreld.setAuthToken(renewedDashboardToken)
	await expect(umbreld.client.user.getHttpApiToken.query()).resolves.toBe(fileToken)
})

test('the local system token remains cookie-free for trusted internal clients', async () => {
	const systemToken = await readFile(umbreld.instance.auth.systemTokenPath, 'utf8')
	const user = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${systemToken}`},
	})
	expect(trpcResult<{name: string}>(user.body)).toMatchObject({name: credentials.name})

	const upload = await umbreld.unauthenticatedApi.post('files/upload?path=/Home/system-upload.txt', {
		body: 'system upload',
		headers: {Authorization: `Bearer ${systemToken}`},
	})
	expect(upload.statusCode).toBe(200)
	const view = await umbreld.unauthenticatedApi.get('files/view?path=/Home/system-upload.txt', {
		headers: {Authorization: `Bearer ${systemToken}`},
		responseType: 'text',
	})
	expect(view.body).toBe('system upload')
})

test('session management lists metadata and account-scoped revocation invalidates the selected login', async () => {
	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {
		json: credentials,
		headers: {'user-agent': 'UmbrelIntegrationSecondary/1.0'},
	})
	const secondDashboardToken = trpcResult<string>(secondLogin.body)
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	if (!secondDashboardToken || !secondBrowserCookie) throw new Error('Second login did not return all credentials')

	const sessions = await umbreld.client.user.listSessions.query()
	const current = sessions.find((session) => session.current)
	const second = sessions.find((session) => session.userAgent === 'UmbrelIntegrationSecondary/1.0')
	expect(current).toBeDefined()
	expect(second).toMatchObject({current: false})
	expect(Object.keys(second!).sort()).toEqual(['createdAt', 'current', 'id', 'lastSeenAt', 'userAgent'])

	await expect(umbreld.client.user.revokeSession.mutate({sessionId: second!.id})).resolves.toEqual({
		revoked: true,
		revokedCurrent: false,
	})
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})
	const revokedRequest = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${secondDashboardToken}`, cookie: secondBrowserCookie},
		throwHttpErrors: false,
	})
	expect(revokedRequest.statusCode).toBe(401)
})

test('normal logout revokes only the browser session making the request', async () => {
	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: credentials})
	const secondDashboardToken = trpcResult<string>(secondLogin.body)
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	if (!secondDashboardToken || !secondBrowserCookie) throw new Error('Second login did not return all credentials')

	await expect(
		umbreld.unauthenticatedApi.post('../trpc/user.logout', {
			json: null,
			headers: {Authorization: `Bearer ${secondDashboardToken}`, cookie: secondBrowserCookie},
		}),
	).resolves.toMatchObject({statusCode: 200})

	const loggedOutRequest = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${secondDashboardToken}`, cookie: secondBrowserCookie},
		throwHttpErrors: false,
	})
	expect(loggedOutRequest.statusCode).toBe(401)
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})
})
