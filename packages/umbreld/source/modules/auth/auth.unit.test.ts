import {EventEmitter} from 'node:events'
import type {Socket} from 'node:net'

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import type {WebSocket} from 'ws'

import type Umbreld from '../../index.js'
import temporaryDirectory from '../utilities/temporary-directory.js'

import Auth, {OWNER_ACCOUNT_ID, SESSION_DURATION} from './auth.js'

class TestSocket extends EventEmitter {
	terminated = false

	terminate() {
		this.terminated = true
		this.emit('close')
	}
}

class TestAppSocket extends EventEmitter {
	destroyed = false

	destroy() {
		this.destroyed = true
		this.emit('close')
		return this
	}
}

class NonCooperatingTestSocket extends EventEmitter {
	close = vi.fn()
	terminate = vi.fn()
}

describe('Auth', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let dataDirectory: string
	let userExists: boolean
	let umbreld: Umbreld
	let auth: Auth

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		dataDirectory = await directory.create()
		userExists = true
		umbreld = {
			dataDirectory,
			isBackupRestoreFirstStart: false,
			user: {exists: async () => userExists},
		} as Umbreld
		auth = new Auth(umbreld)
		await auth.start()
	})

	afterEach(async () => {
		vi.useRealTimers()
		await auth.stop()
		await directory.destroyRoot()
	})

	test('issues audience-bound opaque credentials without storing their raw secrets', async () => {
		const session = await auth.createSession()
		const httpApiToken = await auth.getHttpApiToken(session.principal)
		const tamperedDashboardToken = `${session.dashboardToken.slice(0, -1)}${
			session.dashboardToken.endsWith('0') ? '1' : '0'
		}`

		expect(session.principal).toMatchObject({accountId: OWNER_ACCOUNT_ID, actor: 'account'})
		expect(session.dashboardToken).toMatch(/^umbrel_[0-9a-f]{32}_[0-9a-f]{64}$/)
		expect(session.appGatewayToken).toMatch(/^umbrel_[0-9a-f]{32}_[0-9a-f]{64}$/)
		expect(session.browserSessionToken).toMatch(/^umbrel_[0-9a-f]{32}_[0-9a-f]{64}$/)
		expect(httpApiToken).toMatch(/^umbrel_[0-9a-f]{32}_[0-9a-f]{64}$/)
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(httpApiToken, 'http-api-token')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.dashboardToken, 'app-gateway')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(session.appGatewayToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(session.browserSessionToken, 'http-api-token')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(httpApiToken, 'browser-session')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate('not-an-umbrel-credential', 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(tamperedDashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')

		const stored = await import('node:fs/promises').then((fs) =>
			fs.readFile(`${dataDirectory}/secrets/auth/sessions.yaml`, 'utf8'),
		)
		expect(stored).not.toContain(session.dashboardToken)
		expect(stored).not.toContain(session.appGatewayToken)
		expect(stored).not.toContain(session.browserSessionToken)
		expect(stored).not.toContain(httpApiToken)
	})

	test('protects auth state on disk and serializes concurrent session creation', async () => {
		const sessions = await Promise.all(Array.from({length: 8}, () => auth.createSession()))

		for (const session of sessions) {
			await expect(
				auth.authenticateDashboardCredentials(session.dashboardToken, session.browserSessionToken),
			).resolves.toEqual(session.principal)
		}

		const fs = await import('node:fs/promises')
		const authDirectory = await fs.stat(`${dataDirectory}/secrets/auth`)
		const systemToken = await fs.stat(auth.systemTokenPath)
		expect(authDirectory.mode & 0o777).toBe(0o700)
		expect(systemToken.mode & 0o777).toBe(0o600)

		const stored = await fs.readFile(`${dataDirectory}/secrets/auth/sessions.yaml`, 'utf8')
		for (const session of sessions) expect(stored).toContain(session.principal.sessionId)
	})

	test('extends the session without rotating any credentials', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const session = await auth.createSession()
		const httpApiBefore = await auth.getHttpApiToken(session.principal)

		vi.advanceTimersByTime(60_000)
		const renewed = await auth.renewSession(session.principal)
		const httpApiAfter = await auth.getHttpApiToken(session.principal)
		expect(renewed.expiresAt).toBe(Date.now() + SESSION_DURATION)
		expect(renewed.principal).toEqual(session.principal)
		expect(await auth.listSessions(session.principal)).toEqual([
			expect.objectContaining({createdAt: Date.now() - 60_000, lastSeenAt: Date.now()}),
		])
		expect(httpApiAfter).toBe(httpApiBefore)
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(httpApiAfter, 'http-api-token')).resolves.toEqual(session.principal)

		// Renewal must carry every credential past the original session boundary.
		vi.setSystemTime(new Date('2026-01-08T00:00:01Z'))
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(httpApiAfter, 'http-api-token')).resolves.toEqual(session.principal)

		// All credentials expire together at the renewed session boundary.
		vi.setSystemTime(renewed.expiresAt)
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).rejects.toThrow(
			'Invalid credential',
		)
		await expect(auth.authenticate(httpApiAfter, 'http-api-token')).rejects.toThrow('Invalid credential')
	})

	test('rejects every credential at the original session expiry boundary', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const session = await auth.createSession()
		const httpApiToken = await auth.getHttpApiToken(session.principal)

		vi.advanceTimersByTime(SESSION_DURATION - 1)
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).resolves.toEqual(session.principal)
		await expect(auth.authenticate(httpApiToken, 'http-api-token')).resolves.toEqual(session.principal)

		vi.advanceTimersByTime(1)
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).rejects.toThrow(
			'Invalid credential',
		)
		await expect(auth.authenticate(httpApiToken, 'http-api-token')).rejects.toThrow('Invalid credential')
		await expect(auth.validatePrincipal(session.principal)).rejects.toThrow('Invalid session')
	})

	test('closes live WebSocket and app connections as soon as their session expires', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const session = await auth.createSession()
		const webSocket = new TestSocket()
		const appSocket = new TestAppSocket()
		auth.registerWebSocket(session.principal, webSocket as unknown as WebSocket)
		auth.registerAppSocket(session.principal, appSocket as unknown as Socket)
		const closed = new Promise<void>((resolve) => webSocket.once('close', () => resolve()))

		expect(vi.getTimerCount()).toBe(1)
		await vi.advanceTimersByTimeAsync(SESSION_DURATION)
		await closed
		expect(vi.getTimerCount()).toBe(0)

		expect(webSocket.terminated).toBe(true)
		expect(appSocket.destroyed).toBe(true)
		await expect(auth.validatePrincipal(session.principal)).rejects.toThrow('Invalid session')
		const stored = await import('node:fs/promises').then((fs) =>
			fs.readFile(`${dataDirectory}/secrets/auth/sessions.yaml`, 'utf8'),
		)
		expect(stored).not.toContain(session.principal.sessionId)
	})

	test('reschedules live-connection expiry when a session is renewed', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const session = await auth.createSession()
		const webSocket = new TestSocket()
		auth.registerWebSocket(session.principal, webSocket as unknown as WebSocket)
		const closed = new Promise<void>((resolve) => webSocket.once('close', () => resolve()))

		await vi.advanceTimersByTimeAsync(60_000)
		await auth.renewSession(session.principal)
		await vi.advanceTimersByTimeAsync(SESSION_DURATION - 60_000)
		expect(webSocket.terminated).toBe(false)

		await vi.advanceTimersByTimeAsync(60_000)
		await closed
		expect(webSocket.terminated).toBe(true)
	})

	test('dashboard authentication requires the matching browser session credential', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()

		await expect(
			auth.authenticateDashboardCredentials(first.dashboardToken, first.browserSessionToken),
		).resolves.toEqual(first.principal)
		await expect(auth.authenticateDashboardCredentials(first.dashboardToken)).rejects.toThrow(
			'Missing browser session credential',
		)
		await expect(
			auth.authenticateDashboardCredentials(first.dashboardToken, second.browserSessionToken),
		).rejects.toThrow('Invalid browser session credentials')
	})

	test('lists only active account sessions with sanitized display metadata and no credentials', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const older = await auth.createSession({userAgent: ` Browser\tOne\u0000 ${'x'.repeat(600)}`})
		vi.advanceTimersByTime(24 * 60 * 60 * 1000)
		const current = await auth.createSession({userAgent: 'Browser Two/2.0'})

		const sessions = await auth.listSessions(current.principal)
		expect(sessions).toHaveLength(2)
		expect(sessions[0]).toEqual({
			id: current.principal.sessionId,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			userAgent: 'Browser Two/2.0',
			current: true,
		})
		expect(sessions[1]).toMatchObject({id: older.principal.sessionId, current: false})
		expect(sessions[1].userAgent).toHaveLength(512)
		expect(sessions[1].userAgent).toMatch(/^Browser One x+$/)
		expect(Object.keys(sessions[0]).sort()).toEqual(['createdAt', 'current', 'id', 'lastSeenAt', 'userAgent'])

		// The older session disappears from both the listing and persisted state at its exact expiry boundary.
		vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000)
		await expect(auth.listSessions(current.principal)).resolves.toEqual([
			expect.objectContaining({id: current.principal.sessionId, current: true}),
		])
		const stored = await import('node:fs/promises').then((fs) =>
			fs.readFile(`${dataDirectory}/secrets/auth/sessions.yaml`, 'utf8'),
		)
		expect(stored).not.toContain(older.principal.sessionId)
	})

	test('account-scoped individual revocation closes the target and can revoke the caller', async () => {
		const current = await auth.createSession()
		const target = await auth.createSession()
		const targetSocket = new TestSocket()
		const targetAppSocket = new TestAppSocket()
		auth.registerWebSocket(target.principal, targetSocket as unknown as WebSocket)
		auth.registerAppSocket(target.principal, targetAppSocket as unknown as Socket)

		await expect(auth.revokeSessionForAccount(current.principal, target.principal.sessionId)).resolves.toEqual({
			revoked: true,
			revokedCurrent: false,
		})
		expect(targetSocket.terminated).toBe(true)
		expect(targetAppSocket.destroyed).toBe(true)
		await expect(auth.authenticate(target.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(current.dashboardToken, 'dashboard')).resolves.toEqual(current.principal)
		await expect(auth.revokeSessionForAccount(current.principal, target.principal.sessionId)).resolves.toEqual({
			revoked: false,
			revokedCurrent: false,
		})

		await expect(auth.revokeSessionForAccount(current.principal, current.principal.sessionId)).resolves.toEqual({
			revoked: true,
			revokedCurrent: true,
		})
		await expect(auth.validatePrincipal(current.principal)).rejects.toThrow('Invalid session')
	})

	test('force-terminates a revoked WebSocket without waiting for the peer close handshake', async () => {
		const session = await auth.createSession()
		const socket = new NonCooperatingTestSocket()
		auth.registerWebSocket(session.principal, socket as unknown as WebSocket)

		await auth.revokeSession(session.principal.sessionId)

		expect(socket.terminate).toHaveBeenCalledTimes(1)
		expect(socket.close).not.toHaveBeenCalled()
	})

	test('revokes every other account session while preserving the caller', async () => {
		const current = await auth.createSession()
		const firstOther = await auth.createSession()
		const secondOther = await auth.createSession()
		const socket = new TestSocket()
		auth.registerWebSocket(firstOther.principal, socket as unknown as WebSocket)

		await expect(auth.revokeOtherSessionsForAccount(current.principal)).resolves.toBe(2)
		await expect(auth.listSessions(current.principal)).resolves.toEqual([
			expect.objectContaining({id: current.principal.sessionId, current: true}),
		])
		await expect(auth.authenticate(current.dashboardToken, 'dashboard')).resolves.toEqual(current.principal)
		await expect(auth.authenticate(firstOther.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(secondOther.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		expect(socket.terminated).toBe(true)
	})

	test('manual session management rejects system and forged account principals', async () => {
		const session = await auth.createSession()
		const systemPrincipal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'} as const
		const forgedPrincipal = {...session.principal, accountId: 'another-account'}

		await expect(auth.listSessions(systemPrincipal)).rejects.toThrow('Invalid session')
		await expect(auth.revokeSessionForAccount(systemPrincipal, session.principal.sessionId)).rejects.toThrow(
			'Invalid session',
		)
		await expect(auth.revokeOtherSessionsForAccount(systemPrincipal)).rejects.toThrow('Invalid session')
		await expect(auth.revokeAllSessionsForAccount(systemPrincipal)).rejects.toThrow('Invalid session')
		await expect(auth.listSessions(forgedPrincipal)).rejects.toThrow('Invalid session')
		await expect(auth.revokeSessionForAccount(forgedPrincipal, session.principal.sessionId)).rejects.toThrow(
			'Invalid session',
		)
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).resolves.toEqual(session.principal)
	})

	test('revokes one session without affecting another session for the account', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()

		await expect(auth.revokeSession(first.principal.sessionId)).resolves.toBe(true)
		await expect(auth.authenticate(first.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.validatePrincipal(first.principal)).rejects.toThrow('Invalid session')
		await expect(auth.authenticate(second.dashboardToken, 'dashboard')).resolves.toEqual(second.principal)
	})

	test('revokes every credential and live socket for an account', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()
		const firstHttpApiToken = await auth.getHttpApiToken(first.principal)
		const secondHttpApiToken = await auth.getHttpApiToken(second.principal)
		const socket = new TestSocket()
		const appSocket = new TestAppSocket()
		auth.registerWebSocket(first.principal, socket as unknown as WebSocket)
		auth.registerAppSocket(first.principal, appSocket as unknown as Socket)

		await expect(auth.revokeAllForAccount(OWNER_ACCOUNT_ID)).resolves.toBe(2)
		for (const session of [first, second]) {
			await expect(auth.authenticate(session.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
			await expect(auth.authenticate(session.appGatewayToken, 'app-gateway')).rejects.toThrow('Invalid credential')
			await expect(auth.authenticate(session.browserSessionToken, 'browser-session')).rejects.toThrow(
				'Invalid credential',
			)
		}
		await expect(auth.authenticate(firstHttpApiToken, 'http-api-token')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(secondHttpApiToken, 'http-api-token')).rejects.toThrow('Invalid credential')
		expect(socket.terminated).toBe(true)
		expect(appSocket.destroyed).toBe(true)
	})

	test('persists sessions and their display metadata across auth service restarts', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const session = await auth.createSession({userAgent: 'Persisted Browser/1.0'})
		const httpApiToken = await auth.getHttpApiToken(session.principal)
		vi.advanceTimersByTime(60_000)
		await auth.renewSession(session.principal)
		const lastSeenAt = Date.now()
		await auth.stop()

		auth = new Auth(umbreld)
		await auth.start()
		await expect(
			auth.authenticateDashboardCredentials(session.dashboardToken, session.browserSessionToken),
		).resolves.toEqual(session.principal)
		await expect(auth.getHttpApiToken(session.principal)).resolves.toBe(httpApiToken)
		await expect(auth.listSessions(session.principal)).resolves.toEqual([
			expect.objectContaining({
				id: session.principal.sessionId,
				lastSeenAt,
				userAgent: 'Persisted Browser/1.0',
				current: true,
			}),
		])
	})

	test('removes expired persisted sessions on startup', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const session = await auth.createSession()
		vi.advanceTimersByTime(SESSION_DURATION)
		await auth.stop()

		auth = new Auth(umbreld)
		await auth.start()
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		const stored = await import('node:fs/promises').then((fs) =>
			fs.readFile(`${dataDirectory}/secrets/auth/sessions.yaml`, 'utf8'),
		)
		expect(stored).not.toContain(session.principal.sessionId)
	})

	test('does not create account sessions before an account exists', async () => {
		userExists = false
		await expect(auth.createSession()).rejects.toThrow('Account does not exist')
	})

	test('invalidates restored sessions', async () => {
		const session = await auth.createSession()
		const systemToken = await import('node:fs/promises').then((fs) => fs.readFile(auth.systemTokenPath, 'utf8'))
		await auth.stop()

		umbreld.isBackupRestoreFirstStart = true
		auth = new Auth(umbreld)
		await auth.start()
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
		await expect(auth.authenticate(systemToken, 'dashboard')).rejects.toThrow('Invalid credential')
	})

	test('rejects sessions when their account no longer exists', async () => {
		const session = await auth.createSession()
		userExists = false
		await expect(auth.authenticate(session.dashboardToken, 'dashboard')).rejects.toThrow('Invalid credential')
	})

	test.each([
		{connection: 'WebSocket', invalidatedBy: 'revoked'},
		{connection: 'WebSocket', invalidatedBy: 'expired'},
		{connection: 'app socket', invalidatedBy: 'revoked'},
		{connection: 'app socket', invalidatedBy: 'expired'},
	] as const)(
		'rejects late $connection registration when a session is $invalidatedBy during asynchronous authentication',
		async ({connection, invalidatedBy}) => {
			if (invalidatedBy === 'expired') {
				vi.useFakeTimers()
				vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
			}
			const session = await auth.createSession()

			let markAccountCheckStarted!: () => void
			const accountCheckStarted = new Promise<void>((resolve) => (markAccountCheckStarted = resolve))
			let resumeAccountCheck!: (exists: boolean) => void
			vi.spyOn(umbreld.user, 'exists').mockImplementation(() => {
				markAccountCheckStarted()
				return new Promise<boolean>((resolve) => (resumeAccountCheck = resolve))
			})

			const authentication =
				connection === 'WebSocket'
					? auth.consumeWebSocketTicket(auth.issueWebSocketTicket(session.principal))
					: auth.authenticate(session.appGatewayToken, 'app-gateway')
			await accountCheckStarted
			if (invalidatedBy === 'revoked') await auth.revokeSession(session.principal.sessionId)
			else vi.setSystemTime(new Date(Date.now() + SESSION_DURATION))
			resumeAccountCheck(true)

			// Authentication began while the session was valid, so its asynchronous
			// account check can still return the now-stale principal. Registration is
			// the final synchronous authorization boundary for long-lived sockets.
			const stalePrincipal = await authentication
			if (connection === 'WebSocket') {
				const socket = new TestSocket()
				expect(auth.registerWebSocket(stalePrincipal, socket as unknown as WebSocket)).toBe(false)
				expect(socket.terminated).toBe(true)
			} else {
				const socket = new TestAppSocket()
				expect(auth.registerAppSocket(stalePrincipal, socket as unknown as Socket)).toBe(false)
				expect(socket.destroyed).toBe(true)
			}
		},
	)

	test('WebSocket tickets are short-lived and single-use', async () => {
		vi.useFakeTimers()
		const session = await auth.createSession()
		const ticket = auth.issueWebSocketTicket(session.principal)

		await expect(auth.consumeWebSocketTicket(ticket)).resolves.toEqual(session.principal)
		await expect(auth.consumeWebSocketTicket(ticket)).rejects.toThrow('Invalid WebSocket ticket')

		const expiredTicket = auth.issueWebSocketTicket(session.principal)
		vi.advanceTimersByTime(30_000)
		await expect(auth.consumeWebSocketTicket(expiredTicket)).rejects.toThrow('Invalid WebSocket ticket')

		const revokedSession = await auth.createSession()
		const revokedTicket = auth.issueWebSocketTicket(revokedSession.principal)
		await auth.revokeSession(revokedSession.principal.sessionId)
		await expect(auth.consumeWebSocketTicket(revokedTicket)).rejects.toThrow('Invalid WebSocket ticket')
	})

	test('app handoffs are short-lived, app-bound, single-use, and revocable', async () => {
		vi.useFakeTimers()
		const session = await auth.createSession()
		const handoff = await auth.issueAppHandoff('files', session.appGatewayToken)

		await expect(auth.consumeAppHandoff('other-app', handoff)).rejects.toThrow('Invalid app handoff')
		await expect(auth.consumeAppHandoff('files', handoff)).rejects.toThrow('Invalid app handoff')

		const validHandoff = await auth.issueAppHandoff('files', session.appGatewayToken)
		await expect(auth.consumeAppHandoff('files', validHandoff)).resolves.toEqual({
			principal: session.principal,
			appGatewayToken: session.appGatewayToken,
		})
		await expect(auth.consumeAppHandoff('files', validHandoff)).rejects.toThrow('Invalid app handoff')

		const expiredHandoff = await auth.issueAppHandoff('files', session.appGatewayToken)
		vi.advanceTimersByTime(30_000)
		await expect(auth.consumeAppHandoff('files', expiredHandoff)).rejects.toThrow('Invalid app handoff')

		const revokedHandoff = await auth.issueAppHandoff('files', session.appGatewayToken)
		await auth.revokeSession(session.principal.sessionId)
		await expect(auth.consumeAppHandoff('files', revokedHandoff)).rejects.toThrow('Invalid app handoff')
	})

	test('HTTP API access requires cookie and URL credentials from the same active session', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()
		const firstHttpApiToken = await auth.getHttpApiToken(first.principal)
		const secondHttpApiToken = await auth.getHttpApiToken(second.principal)

		await expect(
			auth.authorizeHttpApiCredentials(first.browserSessionToken, firstHttpApiToken, 'file-view', '/Home/photo.jpg'),
		).resolves.toEqual(first.principal)
		await expect(
			auth.authorizeHttpApiCredentials(first.browserSessionToken, secondHttpApiToken, 'file-view'),
		).rejects.toThrow('Invalid HTTP API credentials')
		await expect(
			auth.authorizeHttpApiCredentials(first.dashboardToken, firstHttpApiToken, 'file-view'),
		).rejects.toThrow('Invalid HTTP API credentials')
		await expect(
			auth.authorizeHttpApiCredentials(first.browserSessionToken, first.appGatewayToken, 'file-view'),
		).rejects.toThrow('Invalid HTTP API credentials')

		await auth.revokeSession(first.principal.sessionId)
		await expect(
			auth.authorizeHttpApiCredentials(first.browserSessionToken, firstHttpApiToken, 'file-view'),
		).rejects.toThrow('Invalid HTTP API credentials')
	})

	test('accepts the local system credential only for dashboard authentication', async () => {
		const systemToken = await import('node:fs/promises').then((fs) => fs.readFile(auth.systemTokenPath, 'utf8'))
		await expect(auth.authenticate(systemToken, 'dashboard')).resolves.toEqual({
			sessionId: 'system',
			accountId: OWNER_ACCOUNT_ID,
			actor: 'system',
		})
		await expect(auth.authenticateDashboardCredentials(systemToken)).resolves.toEqual({
			sessionId: 'system',
			accountId: OWNER_ACCOUNT_ID,
			actor: 'system',
		})
		await expect(auth.authenticate(systemToken, 'app-gateway')).rejects.toThrow('Invalid credential')
	})
})
