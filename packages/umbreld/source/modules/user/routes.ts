import {TRPCError} from '@trpc/server'
import {z} from 'zod'

import {router, publicProcedure, privateProcedure} from '../server/trpc/trpc.js'
import {detectDevice} from '../system/system.js'
import * as totp from '../utilities/totp.js'
import {appGatewayTokenFromRequest, clearAppGatewayCookies, setAppGatewayCookie} from '../auth/app-gateway-cookie.js'
import {
	browserSessionTokenFromRequest,
	clearBrowserSessionCookies,
	setBrowserSessionCookie,
} from '../auth/browser-session-cookie.js'

// Returns the default wallpaper based on device type
// Pro/Home get forest wallpaper (22), others get classic (18)
async function getDefaultWallpaper(): Promise<string> {
	const device = await detectDevice()
	if (device.productName === 'Umbrel Home' || device.productName === 'Umbrel Pro') {
		return '22'
	}
	return '18'
}

export default router({
	// Registers a new user
	register: publicProcedure
		.input(
			z.object({
				name: z.string(),
				password: z.string().min(6, 'Password must be at least 6 characters'),
				language: z.string().optional().default('en'),
				// Currently unused
				raidDevices: z.array(z.string()).optional(),
				raidType: z.enum(['storage', 'failsafe']).optional(),
				acceleratorDevices: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check the user hasn't already signed up
			if (await ctx.user.exists()) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Attempted to register when user is already registered'})
			}

			// If we're on Umbrel Pro, check we jave a valid raid setup config
			const isUmbrelPro = await ctx.umbreld.hardware.umbrelPro.isUmbrelPro()
			const hasRaidDetails = input.raidType && input.raidDevices && input.raidDevices.length > 0
			if (isUmbrelPro && !hasRaidDetails) {
				throw new TRPCError({code: 'BAD_REQUEST', message: 'RAID devices are required for Umbrel Pro'})
			}

			// If we have a valid raid setup details, trigger the initial RAID setup boot process
			// We'll reboot into the RAID filesystem and then the RAID module will setup the user on the next boot
			if (hasRaidDetails) {
				await ctx.umbreld.hardware.raid.triggerInitialRaidSetupBootFlow(
					input.raidDevices!,
					input.raidType!,
					input.acceleratorDevices,
					{
						name: input.name,
						password: input.password,
						language: input.language,
					},
				)
				return true
			}

			// Register new user
			return ctx.user.register(input.name, input.password, input.language)
		}),

	// Public method to check if a user exists
	exists: publicProcedure.query(async ({ctx}) => ctx.user.exists()),

	// Given valid credentials returns a token for a user
	login: publicProcedure
		.input(
			z.object({
				password: z.string(),
				totpToken: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const loginError = await ctx.user.validateLogin(input.password, input.totpToken)
			if (loginError) throw new TRPCError({code: 'UNAUTHORIZED', message: loginError})
			const session = await ctx.umbreld.auth.createSession({userAgent: ctx.request!.get('user-agent')})
			setAppGatewayCookie(ctx.response!, ctx.request!, session.appGatewayToken, new Date(session.expiresAt))
			setBrowserSessionCookie(ctx.response!, ctx.request!, session.browserSessionToken, new Date(session.expiresAt))

			return session.dashboardToken
		}),

	// Checks if the request has a valid token
	isLoggedIn: publicProcedure.query(async ({ctx}) => {
		try {
			const token = ctx.request!.headers.authorization?.split(' ')[1]
			await ctx.umbreld.auth.authenticateDashboardCredentials(token!, browserSessionTokenFromRequest(ctx.request!))
			return true
		} catch {
			return false
		}
	}),

	// Extends the current session and returns its unchanged dashboard token.
	renewToken: privateProcedure.mutation(async ({ctx}) => {
		const token = ctx.request!.headers.authorization?.split(' ')[1]
		if (!token) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		const session = await ctx.umbreld.auth.renewSession(ctx.principal!)

		// Keep the app credential stable across dashboard renewal. Rotating it here
		// would invalidate app cookies on every other hostname and Tor onion.
		const appGatewayToken = appGatewayTokenFromRequest(ctx.request!)
		if (appGatewayToken) {
			const appPrincipal = await ctx.umbreld.auth.authenticate(appGatewayToken, 'app-gateway').catch(() => null)
			if (appPrincipal?.sessionId === session.principal.sessionId) {
				setAppGatewayCookie(ctx.response!, ctx.request!, appGatewayToken, new Date(session.expiresAt))
			}
		}

		// The browser credential is stable for the session. Reissue the credential
		// that authenticated this exact request so its browser expiry follows the
		// sliding backend session. A missing cookie cannot bootstrap a replacement.
		const browserSessionToken = browserSessionTokenFromRequest(ctx.request!)
		if (!browserSessionToken) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		setBrowserSessionCookie(ctx.response!, ctx.request!, browserSessionToken, new Date(session.expiresAt))

		return token
	}),

	createWebSocketTicket: privateProcedure.mutation(async ({ctx}) =>
		ctx.umbreld.auth.issueWebSocketTicket(ctx.principal!),
	),

	getHttpApiToken: privateProcedure.query(async ({ctx}) => {
		if (!ctx.request || !ctx.response) {
			throw new TRPCError({code: 'METHOD_NOT_SUPPORTED', message: 'HTTP transport required'})
		}
		const token = await ctx.umbreld.auth.getHttpApiToken(ctx.principal!)
		ctx.response.set('Cache-Control', 'no-store')
		return token
	}),

	listSessions: privateProcedure.query(async ({ctx}) => ctx.umbreld.auth.listSessions(ctx.principal!)),

	revokeSession: privateProcedure
		.input(z.object({sessionId: z.string().regex(/^[0-9a-f]{32}$/)}))
		.mutation(async ({ctx, input}) => {
			const result = await ctx.umbreld.auth.revokeSessionForAccount(ctx.principal!, input.sessionId)
			if (result.revokedCurrent) {
				clearAppGatewayCookies(ctx.response!)
				clearBrowserSessionCookies(ctx.response!)
			}
			return result
		}),

	revokeOtherSessions: privateProcedure.mutation(async ({ctx}) => ({
		revokedCount: await ctx.umbreld.auth.revokeOtherSessionsForAccount(ctx.principal!),
	})),

	revokeAllSessions: privateProcedure.mutation(async ({ctx}) => {
		const revokedCount = await ctx.umbreld.auth.revokeAllSessionsForAccount(ctx.principal!)
		clearAppGatewayCookies(ctx.response!)
		clearBrowserSessionCookies(ctx.response!)
		return {revokedCount, revokedCurrent: true}
	}),

	// Log out only the session making this request. Global revocation remains an
	// explicit action in the active-sessions UI.
	logout: privateProcedure.mutation(async ({ctx}) => {
		await ctx.umbreld.auth.revokeSession(ctx.principal!.sessionId)
		clearAppGatewayCookies(ctx.response!)
		clearBrowserSessionCookies(ctx.response!)
		return true
	}),

	// Verifies a sensitive action without creating a replacement login session.
	verifyPassword: privateProcedure.input(z.object({password: z.string()})).mutation(async ({ctx, input}) => {
		if (!(await ctx.user.validatePassword(input.password))) {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect password'})
		}
		return true
	}),

	// Change the user's password
	changePassword: privateProcedure
		.input(
			z.object({
				oldPassword: z.string(),
				newPassword: z.string().min(6, 'Password must be at least 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Validate old password
			if (!(await ctx.user.validatePassword(input.oldPassword))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect password'})
			}
			return ctx.user.setPassword(input.newPassword)
		}),

	// Generates a new random 2FA TOTP URI
	generateTotpUri: privateProcedure.query(async () => totp.generateUri('Umbrel', 'umbrel.local')),

	// Enables 2FA
	enable2fa: privateProcedure
		.input(
			z.object({
				totpUri: z.string(),
				totpToken: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check if 2FA is already enabled
			if (await ctx.user.is2faEnabled()) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is already enabled'})
			}

			// Verify the token
			if (!totp.verify(input.totpUri, input.totpToken)) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
			}

			// Save URI
			return ctx.user.enable2fa(input.totpUri)
		}),

	is2faEnabled: publicProcedure.query(async ({ctx}) => ctx.user.is2faEnabled()),

	// Disables 2FA
	disable2fa: privateProcedure
		.input(
			z.object({
				totpToken: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check if 2FA is already enabled
			if (!(await ctx.user.is2faEnabled())) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is not enabled'})
			}

			// Verify the token
			if (!(await ctx.user.validate2faToken(input.totpToken))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
			}

			// Delete the URI
			return ctx.user.disable2fa()
		}),

	// Returns the current user
	get: privateProcedure.query(async ({ctx}) => {
		const user = await ctx.user.get()

		if (user.wallpaper === undefined) {
			user.wallpaper = await getDefaultWallpaper()
		}

		// Only return non sensitive data
		return {
			name: user.name,
			wallpaper: user.wallpaper,
			language: user.language,
			temperatureUnit: user.temperatureUnit,
		}
	}),

	// Sets whitelisted properties on the user object
	set: privateProcedure
		.input(
			z
				.object({
					name: z.string().optional(),
					wallpaper: z.string().optional(),
					language: z.string().optional(),
					temperatureUnit: z.string().optional(),
				})
				.strict(),
		)
		.mutation(async ({ctx, input}) => {
			if (input.name) await ctx.user.setName(input.name)
			if (input.wallpaper) await ctx.user.setWallpaper(input.wallpaper)
			if (input.language) await ctx.user.setLanguage(input.language)
			if (input.temperatureUnit) await ctx.user.setTemperatureUnit(input.temperatureUnit)

			return true
		}),

	// Returns the users wallpaper
	// This endpoint is public so it can be shown on the login screen
	wallpaper: publicProcedure.query(async ({ctx}) => {
		const user = await ctx.user.get()
		return user?.wallpaper ?? (await getDefaultWallpaper())
	}),

	// Returns the preferred language, if any
	// This endpoint is public so it can be used on the login screen
	language: publicProcedure.query(async ({ctx}) => {
		const user = await ctx.user.get()
		return user?.language ?? null
	}),
})
