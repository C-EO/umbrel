import {createHash, createHmac, timingSafeEqual} from 'node:crypto'
import type {Socket} from 'node:net'
import nodePath from 'node:path'

import fse from 'fs-extra'
import type {WebSocket} from 'ws'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'
import FileStore from '../utilities/file-store.js'
import getOrCreateFile from '../utilities/get-or-create-file.js'
import randomToken from '../utilities/random-token.js'

export const OWNER_ACCOUNT_ID = OWNER_USER_ID

const ONE_SECOND = 1000
const ONE_MINUTE = 60 * ONE_SECOND
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
export const SESSION_DURATION = 7 * ONE_DAY
const WEBSOCKET_TICKET_DURATION = 30 * ONE_SECOND
const APP_HANDOFF_DURATION = 30 * ONE_SECOND

export type CredentialAudience = 'dashboard' | 'app-gateway' | 'browser-session' | 'http-api-token'
export type HttpApiScope = 'file-download' | 'file-view' | 'file-thumbnail' | 'logs-download' | 'ca-download'
export type WebSocketTarget = 'trpc' | 'terminal'

export type Principal = {
	sessionId: string
	accountId: string
	actor: 'account' | 'system'
}

type Credential = {
	id: string
	audience: CredentialAudience
	hash: string
}

type Session = {
	id: string
	accountId: string
	createdAt: number
	lastSeenAt: number
	expiresAt: number
	userAgent?: string
	credentials: Credential[]
}

export type ActiveSession = {
	id: string
	createdAt: number
	lastSeenAt: number
	userAgent?: string
	current: boolean
}

type AuthStore = {
	sessions: Session[]
}

type WebSocketTicket = {
	principal: Principal
	target: WebSocketTarget
	expiresAt: number
}

type AppHandoff = {
	appId: string
	appGatewayToken: string
	expiresAt: number
}

type AppSocket = {
	principal: Principal
	appId: string
	socket: Socket
}

type SessionIssuanceState = {
	revision: number
	credentialChanges: number
}

export class SessionIssuanceInvalidatedError extends Error {
	constructor() {
		super('Login credentials changed, try again')
	}
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

const normalizeUserAgent = (userAgent: string | undefined) => {
	const normalized = userAgent
		?.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 512)
	return normalized || undefined
}

const parseCredential = (token: string) => {
	const match = /^umbrel_([0-9a-f]{32})_([0-9a-f]{64})$/.exec(token)
	if (!match) throw new Error('Invalid credential')
	return {id: match[1], secret: match[2]}
}

const secretsMatch = (actual: string, expected: string) => {
	const actualBuffer = Buffer.from(actual, 'hex')
	const expectedBuffer = Buffer.from(expected, 'hex')
	return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export default class Auth {
	#umbreld: Umbreld
	#store: FileStore<AuthStore>
	#directory: string
	#systemToken = ''
	#sessions: Session[] = []
	#webSocketTickets = new Map<string, WebSocketTicket>()
	#appHandoffs = new Map<string, AppHandoff>()
	#webSockets = new Map<string, Set<WebSocket>>()
	#appSockets = new Map<string, Set<AppSocket>>()
	#appAccessRevision = 0
	#sessionExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
	#sessionIssuanceStates = new Map<string, SessionIssuanceState>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.#directory = nodePath.join(umbreld.dataDirectory, 'secrets', 'auth')
		this.#store = new FileStore<AuthStore>({filePath: nodePath.join(this.#directory, 'sessions.yaml')})
	}

	async start() {
		await fse.ensureDir(this.#directory, {mode: 0o700})
		await fse.chmod(this.#directory, 0o700)

		if (this.#umbreld.isBackupRestoreFirstStart) {
			await this.#store.set('sessions', [])
			await fse.remove(nodePath.join(this.#directory, 'system-token'))
		}

		this.#sessions = (await this.#store.get('sessions')) ?? []
		this.#systemToken = await getOrCreateFile(nodePath.join(this.#directory, 'system-token'), randomToken(256))
		await fse.chmod(nodePath.join(this.#directory, 'system-token'), 0o600)
		await this.#removeExpiredSessions()
		for (const session of this.#sessions) this.#scheduleSessionExpiry(session)
	}

	async stop() {
		for (const sockets of this.#webSockets.values()) {
			for (const socket of sockets) socket.terminate()
		}
		for (const sockets of this.#appSockets.values()) {
			for (const {socket} of sockets) socket.destroy()
		}
		this.#webSockets.clear()
		this.#appSockets.clear()
		for (const timeout of this.#sessionExpiryTimers.values()) clearTimeout(timeout)
		this.#sessionExpiryTimers.clear()
		this.#sessions = []
		this.#webSocketTickets.clear()
		this.#appHandoffs.clear()
		this.#sessionIssuanceStates.clear()
	}

	async createSession({
		accountId = OWNER_ACCOUNT_ID,
		userAgent,
		expectedSessionIssuanceRevision,
	}: {
		accountId?: string
		userAgent?: string
		expectedSessionIssuanceRevision?: number
	} = {}) {
		if (!(await this.#accountExists(accountId))) throw new Error('Account does not exist')

		const now = Date.now()
		const session: Session = {
			id: randomToken(128),
			accountId,
			createdAt: now,
			lastSeenAt: now,
			expiresAt: now + SESSION_DURATION,
			userAgent: normalizeUserAgent(userAgent),
			credentials: [],
		}
		const dashboard = this.#createCredential('dashboard')
		const appGateway = this.#createCredential('app-gateway')
		const browserSession = this.#createCredential('browser-session')
		const httpApiToken = this.#createDerivedCredential(session.id, 'http-api-token')
		session.credentials = [dashboard.record, appGateway.record, browserSession.record, httpApiToken.record]

		let expiredSessionIds: string[] = []
		await this.#store.getWriteLock(async ({set}) => {
			if (expectedSessionIssuanceRevision !== undefined) {
				const state = this.#sessionIssuanceState(accountId)
				if (state.credentialChanges > 0 || state.revision !== expectedSessionIssuanceRevision) {
					throw new SessionIssuanceInvalidatedError()
				}
			}

			const activeSessions = this.#sessions.filter((candidate) => candidate.expiresAt > now)
			expiredSessionIds = this.#sessions
				.filter((candidate) => !activeSessions.includes(candidate))
				.map((candidate) => candidate.id)
			const sessions = [...activeSessions, session]
			await set('sessions', sessions)
			this.#sessions = sessions
			this.#scheduleSessionExpiry(session)
		})
		for (const sessionId of expiredSessionIds) this.#removeSessionRuntimeState(sessionId)

		return {
			principal: this.#principalForSession(session),
			expiresAt: session.expiresAt,
			dashboardToken: dashboard.token,
			appGatewayToken: appGateway.token,
			browserSessionToken: browserSession.token,
		}
	}

	// Login captures this before checking the account's password and MFA. The
	// same revision must still be current when its session is committed.
	sessionIssuanceRevision(accountId: string) {
		return this.#sessionIssuanceState(accountId).revision
	}

	// Credential writes bracket their full operation with this guard. A login
	// that overlaps any part of the write cannot commit a session authenticated
	// against stale password or MFA state.
	beginAccountCredentialChange(accountId: string) {
		const state = this.#sessionIssuanceState(accountId)
		state.revision++
		state.credentialChanges++
		let finished = false

		return () => {
			if (finished) return
			finished = true
			state.credentialChanges--
			state.revision++
		}
	}

	async renewSession(principal: Principal) {
		await this.validatePrincipal(principal)
		if (principal.actor !== 'account') throw new Error('Invalid session')
		const now = Date.now()
		let expiresAt = now + SESSION_DURATION

		await this.#store.getWriteLock(async ({set}) => {
			const session = this.#sessions.find((candidate) => candidate.id === principal.sessionId)
			if (!session || session.expiresAt <= now) throw new Error('Invalid session')
			const sessions = this.#sessions.map((candidate) =>
				candidate.id === principal.sessionId ? {...candidate, lastSeenAt: now, expiresAt} : candidate,
			)
			await set('sessions', sessions)
			this.#sessions = sessions
			this.#scheduleSessionExpiry({id: principal.sessionId, expiresAt})
		})

		return {principal, expiresAt}
	}

	async authenticateDashboardCredentials(dashboardToken: string, browserSessionToken?: string) {
		const dashboardPrincipal = await this.authenticate(dashboardToken, 'dashboard')
		if (dashboardPrincipal.actor === 'system') return dashboardPrincipal
		if (!browserSessionToken) throw new Error('Missing browser session credential')

		const browserPrincipal = await this.authenticate(browserSessionToken, 'browser-session').catch(() => {
			throw new Error('Invalid browser session credentials')
		})
		if (!this.#sameSession(dashboardPrincipal, browserPrincipal)) {
			throw new Error('Invalid browser session credentials')
		}
		return dashboardPrincipal
	}

	async authenticate(token: string, audience: CredentialAudience): Promise<Principal> {
		if (audience === 'dashboard' && this.#isSystemToken(token)) {
			return {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'}
		}

		const {id, secret} = parseCredential(token)
		const now = Date.now()
		const session = this.#sessions.find((candidate) => candidate.credentials.some((credential) => credential.id === id))
		const credential = session?.credentials.find((candidate) => candidate.id === id)

		if (
			!session ||
			!credential ||
			credential.audience !== audience ||
			session.expiresAt <= now ||
			!secretsMatch(hash(secret), credential.hash) ||
			!(await this.#accountExists(session.accountId))
		) {
			throw new Error('Invalid credential')
		}

		return this.#principalForSession(session)
	}

	async validatePrincipal(principal: Principal) {
		if (principal.actor === 'system') return principal
		const session = this.#sessions.find((candidate) => candidate.id === principal.sessionId)
		if (
			!session ||
			session.accountId !== principal.accountId ||
			session.expiresAt <= Date.now() ||
			!(await this.#accountExists(session.accountId))
		) {
			throw new Error('Invalid session')
		}
		return principal
	}

	// The owner and local system credential can reach every installed app.
	// Members can only reach apps explicitly shared with their account.
	async authorizeApp(principal: Principal, appId: string) {
		await this.validatePrincipal(principal)
		if (principal.actor === 'system' || principal.accountId === OWNER_ACCOUNT_ID) return principal

		const sharedAppIds = await this.#umbreld.apps.sharedAppIdsForUser(principal.accountId)
		if (!sharedAppIds.includes(appId)) throw new Error('App access denied')
		return principal
	}

	async listSessions(principal: Principal): Promise<ActiveSession[]> {
		await this.#validateAccountPrincipal(principal)
		await this.#removeExpiredSessions()
		await this.#validateAccountPrincipal(principal)

		return this.#activeSessionsForAccount(principal.accountId, principal.sessionId)
	}

	// Owner-only account administration. These methods still validate the
	// caller here instead of relying solely on the route middleware so future
	// call sites cannot accidentally expose cross-account session management.
	async listSessionsForOwner(principal: Principal, accountId: string): Promise<ActiveSession[]> {
		await this.#validateOwnerPrincipal(principal)
		await this.#removeExpiredSessions()
		await this.#validateOwnerPrincipal(principal)
		if (!(await this.#accountExists(accountId))) throw new Error('Account does not exist')
		return this.#activeSessionsForAccount(accountId, principal.sessionId)
	}

	#activeSessionsForAccount(accountId: string, currentSessionId?: string): ActiveSession[] {
		return this.#sessions
			.filter((session) => session.accountId === accountId)
			.map((session) => ({
				id: session.id,
				createdAt: session.createdAt,
				lastSeenAt: session.lastSeenAt,
				userAgent: session.userAgent,
				current: session.id === currentSessionId,
			}))
			.sort((first, second) => Number(second.current) - Number(first.current) || second.createdAt - first.createdAt)
	}

	async revokeSessionForAccount(principal: Principal, sessionId: string) {
		await this.#validateAccountPrincipal(principal)
		const revokedSessionIds = await this.#revokeSessions(
			(session) => session.accountId === principal.accountId && session.id === sessionId,
			principal,
		)
		return {
			revoked: revokedSessionIds.length === 1,
			revokedCurrent: revokedSessionIds.includes(principal.sessionId),
		}
	}

	async revokeOtherSessionsForAccount(principal: Principal) {
		await this.#validateAccountPrincipal(principal)
		this.#invalidatePendingSessionIssuance(principal.accountId)
		const revokedSessionIds = await this.#revokeSessions(
			(session) => session.accountId === principal.accountId && session.id !== principal.sessionId,
			principal,
		)
		return revokedSessionIds.length
	}

	async revokeAllSessionsForAccount(principal: Principal) {
		await this.#validateAccountPrincipal(principal)
		this.#invalidatePendingSessionIssuance(principal.accountId)
		const revokedSessionIds = await this.#revokeSessions(
			(session) => session.accountId === principal.accountId,
			principal,
		)
		return revokedSessionIds.length
	}

	async revokeSessionForOwner(principal: Principal, accountId: string, sessionId: string) {
		await this.#validateOwnerPrincipal(principal)
		const revokedSessionIds = await this.#revokeSessions(
			(session) => session.accountId === accountId && session.id === sessionId,
			principal,
		)
		return {
			revoked: revokedSessionIds.length === 1,
			revokedCurrent: revokedSessionIds.includes(principal.sessionId),
		}
	}

	async revokeAllSessionsForOwner(principal: Principal, accountId: string) {
		await this.#validateOwnerPrincipal(principal)
		this.#invalidatePendingSessionIssuance(accountId)
		const revokedSessionIds = await this.#revokeSessions((session) => session.accountId === accountId, principal)
		return {
			revokedCount: revokedSessionIds.length,
			revokedCurrent: revokedSessionIds.includes(principal.sessionId),
		}
	}

	async revokeSession(sessionId: string) {
		if (sessionId === 'system') return false
		return (await this.#revokeSessions((session) => session.id === sessionId)).length === 1
	}

	async revokeAllForAccount(accountId: string) {
		this.#invalidatePendingSessionIssuance(accountId)
		return (await this.#revokeSessions((session) => session.accountId === accountId)).length
	}

	issueWebSocketTicket(principal: Principal, target: WebSocketTarget) {
		this.#removeExpiredTickets()
		const token = randomToken(256)
		this.#webSocketTickets.set(hash(token), {principal, target, expiresAt: Date.now() + WEBSOCKET_TICKET_DURATION})
		return token
	}

	async consumeWebSocketTicket(token: string, target: WebSocketTarget) {
		const tokenHash = hash(token)
		const ticket = this.#webSocketTickets.get(tokenHash)
		this.#webSocketTickets.delete(tokenHash)
		if (!ticket || ticket.target !== target || ticket.expiresAt <= Date.now()) {
			throw new Error('Invalid WebSocket ticket')
		}
		return this.validatePrincipal(ticket.principal).catch(() => {
			throw new Error('Invalid WebSocket ticket')
		})
	}

	async issueAppHandoff(appId: string, appGatewayToken: string) {
		this.#removeExpiredAppHandoffs()
		const principal = await this.authenticate(appGatewayToken, 'app-gateway')
		await this.authorizeApp(principal, appId)

		const token = randomToken(256)
		this.#appHandoffs.set(hash(token), {
			appId,
			appGatewayToken,
			expiresAt: Date.now() + APP_HANDOFF_DURATION,
		})
		return token
	}

	async consumeAppHandoff(appId: string, token: string) {
		const tokenHash = hash(token)
		const handoff = this.#appHandoffs.get(tokenHash)
		this.#appHandoffs.delete(tokenHash)
		if (!handoff || handoff.appId !== appId || handoff.expiresAt <= Date.now()) {
			throw new Error('Invalid app handoff')
		}

		const principal = await this.authenticate(handoff.appGatewayToken, 'app-gateway').catch(() => {
			throw new Error('Invalid app handoff')
		})
		await this.authorizeApp(principal, appId).catch(() => {
			throw new Error('Invalid app handoff')
		})
		return {principal, appGatewayToken: handoff.appGatewayToken}
	}

	async getHttpApiToken(principal: Principal) {
		await this.validatePrincipal(principal)
		if (principal.actor !== 'account') throw new Error('Invalid session')

		const session = this.#sessions.find((candidate) => candidate.id === principal.sessionId)
		if (!session) throw new Error('Invalid session')

		return this.#derivedCredentialToken(session, 'http-api-token')
	}

	async authorizeHttpApiCredentials(
		browserSessionToken: string,
		urlToken: string,
		scope: HttpApiScope,
		resource?: string,
	) {
		const [browserPrincipal, urlPrincipal] = await Promise.all([
			this.authenticate(browserSessionToken, 'browser-session'),
			this.authenticate(urlToken, 'http-api-token'),
		]).catch(() => {
			throw new Error('Invalid HTTP API credentials')
		})

		if (!this.#sameSession(browserPrincipal, urlPrincipal)) {
			throw new Error('Invalid HTTP API credentials')
		}

		return this.authorizeHttpApi(urlPrincipal, scope, resource)
	}

	// The URL token is deliberately session-wide rather than bound to a path so
	// browser URLs stay stable for the full sliding session lifetime. File routes
	// resolve their resource using this principal's account id. Device-wide logs
	// and the local CA remain owner-only.
	async authorizeHttpApi(principal: Principal, scope: HttpApiScope, _resource?: string) {
		await this.validatePrincipal(principal)
		if (
			(scope === 'logs-download' || scope === 'ca-download') &&
			principal.actor !== 'system' &&
			principal.accountId !== OWNER_ACCOUNT_ID
		) {
			throw new Error('Owner access required')
		}
		return principal
	}

	registerWebSocket(principal: Principal, socket: WebSocket) {
		if (!this.#isPrincipalActive(principal)) {
			socket.terminate()
			return false
		}
		if (principal.actor === 'system') return true
		const sockets = this.#webSockets.get(principal.sessionId) ?? new Set<WebSocket>()
		sockets.add(socket)
		this.#webSockets.set(principal.sessionId, sockets)
		socket.once('close', () => {
			sockets.delete(socket)
			if (sockets.size === 0) this.#webSockets.delete(principal.sessionId)
		})
		return true
	}

	get appAccessRevision() {
		return this.#appAccessRevision
	}

	registerAppSocket(principal: Principal, appId: string, socket: Socket, accessRevision: number) {
		if (accessRevision !== this.#appAccessRevision || !this.#isPrincipalActive(principal)) {
			socket.destroy()
			return false
		}
		if (principal.actor === 'system') return true
		const sockets = this.#appSockets.get(principal.sessionId) ?? new Set<AppSocket>()
		const registration = {principal, appId, socket}
		sockets.add(registration)
		this.#appSockets.set(principal.sessionId, sockets)
		socket.once('close', () => {
			sockets.delete(registration)
			if (sockets.size === 0) this.#appSockets.delete(principal.sessionId)
		})
		return true
	}

	// Called after an app share changes. Incrementing the revision synchronously
	// prevents an upgrade authorized against the old share state from
	// registering after this sweep. Existing opaque app streams are rechecked
	// and closed if their account no longer has access.
	async appAccessChanged(appId: string) {
		this.#appAccessRevision++
		const registrations = [...this.#appSockets.values()]
			.flatMap((sockets) => [...sockets])
			.filter((registration) => appId === '*' || registration.appId === appId)

		await Promise.all(
			registrations.map(async (registration) => {
				if (registration.socket.destroyed) return
				await this.authorizeApp(registration.principal, registration.appId).catch(() => registration.socket.destroy())
			}),
		)
	}

	get systemTokenPath() {
		return nodePath.join(this.#directory, 'system-token')
	}

	#createCredential(audience: CredentialAudience) {
		const id = randomToken(128)
		const secret = randomToken(256)
		return {
			token: `umbrel_${id}_${secret}`,
			record: {id, audience, hash: hash(secret)},
		}
	}

	#createDerivedCredential(sessionId: string, audience: 'http-api-token') {
		const id = randomToken(128)
		const secret = this.#deriveCredentialSecret(sessionId, id, audience)
		return {
			token: `umbrel_${id}_${secret}`,
			record: {id, audience, hash: hash(secret)},
		}
	}

	#derivedCredentialToken(session: Session, audience: 'http-api-token') {
		const credential = session.credentials.find((candidate) => candidate.audience === audience)
		if (!credential) throw new Error('Invalid session')
		const secret = this.#deriveCredentialSecret(session.id, credential.id, audience)
		if (!secretsMatch(hash(secret), credential.hash)) throw new Error('Invalid session')
		return `umbrel_${credential.id}_${secret}`
	}

	#deriveCredentialSecret(sessionId: string, credentialId: string, audience: CredentialAudience) {
		return createHmac('sha256', Buffer.from(this.#systemToken, 'hex'))
			.update(`umbrel-session-credential-v1\0${audience}\0${sessionId}\0${credentialId}`)
			.digest('hex')
	}

	#principalForSession(session: Session): Principal {
		return {sessionId: session.id, accountId: session.accountId, actor: 'account'}
	}

	#sameSession(first: Principal, second: Principal) {
		return first.sessionId === second.sessionId && first.accountId === second.accountId && first.actor === second.actor
	}

	#isPrincipalActive(principal: Principal) {
		if (principal.actor === 'system') {
			return principal.sessionId === 'system' && principal.accountId === OWNER_ACCOUNT_ID
		}
		const session = this.#sessions.find((candidate) => candidate.id === principal.sessionId)
		return Boolean(session && session.accountId === principal.accountId && session.expiresAt > Date.now())
	}

	#isSystemToken(token: string) {
		if (!this.#systemToken || token.length !== this.#systemToken.length) return false
		return timingSafeEqual(Buffer.from(token), Buffer.from(this.#systemToken))
	}

	#sessionIssuanceState(accountId: string) {
		let state = this.#sessionIssuanceStates.get(accountId)
		if (!state) {
			state = {revision: 0, credentialChanges: 0}
			this.#sessionIssuanceStates.set(accountId, state)
		}
		return state
	}

	#invalidatePendingSessionIssuance(accountId: string) {
		this.#sessionIssuanceState(accountId).revision++
	}

	async #accountExists(accountId: string) {
		if (accountId === OWNER_ACCOUNT_ID) return this.#umbreld.user.exists()
		return Boolean(await this.#umbreld.user.getMember(accountId))
	}

	async #validateAccountPrincipal(principal: Principal) {
		await this.validatePrincipal(principal)
		if (principal.actor !== 'account') throw new Error('Invalid session')
		return principal
	}

	async #validateOwnerPrincipal(principal: Principal) {
		await this.#validateAccountPrincipal(principal)
		if (principal.accountId !== OWNER_ACCOUNT_ID) throw new Error('Owner session required')
		return principal
	}

	async #revokeSessions(predicate: (session: Session) => boolean, requiredPrincipal?: Principal) {
		let revokedSessionIds: string[] = []
		let removedSessionIds: string[] = []

		await this.#store.getWriteLock(async ({set}) => {
			const now = Date.now()
			const activeSessions = this.#sessions.filter((session) => session.expiresAt > now)
			if (
				requiredPrincipal &&
				!activeSessions.some(
					(session) => session.id === requiredPrincipal.sessionId && session.accountId === requiredPrincipal.accountId,
				)
			) {
				throw new Error('Invalid session')
			}

			revokedSessionIds = activeSessions.filter(predicate).map((session) => session.id)
			const sessions = activeSessions.filter((session) => !revokedSessionIds.includes(session.id))
			removedSessionIds = this.#sessions
				.filter((session) => !sessions.some((candidate) => candidate.id === session.id))
				.map((session) => session.id)

			if (removedSessionIds.length > 0) {
				await set('sessions', sessions)
				this.#sessions = sessions
			}
		})

		for (const sessionId of removedSessionIds) this.#removeSessionRuntimeState(sessionId)
		return revokedSessionIds
	}

	async #removeExpiredSessions() {
		await this.#revokeSessions(() => false)
	}

	#scheduleSessionExpiry(session: Pick<Session, 'id' | 'expiresAt'>) {
		const existingTimeout = this.#sessionExpiryTimers.get(session.id)
		if (existingTimeout) clearTimeout(existingTimeout)

		const timeout = setTimeout(
			async () => {
				if (this.#sessionExpiryTimers.get(session.id) !== timeout) return
				this.#sessionExpiryTimers.delete(session.id)
				// Re-check wall time in bounded intervals so an NTP/system-clock jump
				// cannot leave an expired connection open until the original timer delay.
				if (session.expiresAt > Date.now()) {
					this.#scheduleSessionExpiry(session)
					return
				}
				await this.#removeExpiredSessions().catch((error) => {
					// Expiry is still authoritative if persisting the cleanup fails.
					this.#closeSessionConnections(session.id)
					this.#umbreld.logger.error('Failed to expire authentication session', error)
				})
			},
			Math.min(ONE_HOUR, Math.max(0, session.expiresAt - Date.now())),
		)
		timeout.unref()
		this.#sessionExpiryTimers.set(session.id, timeout)
	}

	#removeExpiredTickets() {
		const now = Date.now()
		for (const [token, ticket] of this.#webSocketTickets) {
			if (ticket.expiresAt <= now) this.#webSocketTickets.delete(token)
		}
	}

	#removeExpiredAppHandoffs() {
		const now = Date.now()
		for (const [token, handoff] of this.#appHandoffs) {
			if (handoff.expiresAt <= now) this.#appHandoffs.delete(token)
		}
	}

	#closeSessionConnections(sessionId: string) {
		const webSockets = this.#webSockets.get(sessionId)
		// Revocation is a security boundary. A graceful close lets a hostile peer
		// ignore the close frame and keep sending messages until ws's 30s timeout.
		for (const socket of webSockets ?? []) socket.terminate()
		this.#webSockets.delete(sessionId)

		const appSockets = this.#appSockets.get(sessionId)
		for (const {socket} of appSockets ?? []) socket.destroy()
		this.#appSockets.delete(sessionId)
	}

	#removeSessionRuntimeState(sessionId: string) {
		const timeout = this.#sessionExpiryTimers.get(sessionId)
		if (timeout) clearTimeout(timeout)
		this.#sessionExpiryTimers.delete(sessionId)
		this.#closeSessionConnections(sessionId)
	}
}
