import {TRPCError} from '@trpc/server'

import {type Context} from './context.js'
import {OWNER_ACCOUNT_ID, type Principal} from '../../auth/auth.js'
import {browserSessionTokenFromRequest} from '../../auth/browser-session-cookie.js'

type MiddlewareOptions = {
	ctx: Context
	next: (options?: {ctx: {principal: Principal}}) => Promise<any>
}

const authenticate = async (ctx: Context) => {
	try {
		const [scheme, token] = ctx.request?.headers.authorization?.split(' ') ?? []
		if (scheme?.toLowerCase() !== 'bearer' || !token || !ctx.request) throw new Error('Missing token')
		return await ctx.umbreld.auth.authenticateDashboardCredentials(token, browserSessionTokenFromRequest(ctx.request))
	} catch (error) {
		ctx.logger.error('Failed to verify token', error)
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
	}
}

export const isAuthenticated = async ({ctx, next}: MiddlewareOptions) => {
	if (ctx.dangerouslyBypassAuthentication === true) {
		return next({ctx: {principal: {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'}}})
	}

	if (ctx.transport === 'ws') {
		if (!ctx.principal) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		await ctx.umbreld.auth.validatePrincipal(ctx.principal).catch(() => {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		})
		return next({ctx: {principal: ctx.principal}})
	}

	return next({ctx: {principal: await authenticate(ctx)}})
}

export const isOwner = async ({ctx, next}: MiddlewareOptions) => {
	let principal: Principal
	if (ctx.dangerouslyBypassAuthentication === true) {
		principal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'}
	} else if (ctx.transport === 'ws') {
		if (!ctx.principal) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		await ctx.umbreld.auth.validatePrincipal(ctx.principal).catch(() => {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		})
		principal = ctx.principal
	} else {
		principal = await authenticate(ctx)
	}

	if (principal.accountId !== OWNER_ACCOUNT_ID) {
		throw new TRPCError({code: 'FORBIDDEN', message: 'This action can only be performed by the owner'})
	}
	return next({ctx: {principal}})
}

export const isAuthenticatedIfUserExists = async ({ctx, next}: MiddlewareOptions) => {
	// Allow request through if user has not yet been registered
	const userExists = await ctx.user.exists()
	if (!userExists) {
		return next()
	}

	// If a user exists, follow usual authentication flow
	return isOwner({ctx, next})
}
