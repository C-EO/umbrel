import {ZodError} from 'zod'
import {initTRPC} from '@trpc/server'

import {type Context} from './context.js'
import {isAuthenticated, isAuthenticatedIfUserExists, isOwner} from './is-authenticated.js'
import {websocketLogger} from './websocket-logger.js'

export const t = initTRPC.context<Context>().create({
	// TODO: Add more context on why this is needed
	// https://trpc.io/docs/server/error-formatting#adding-custom-formatting
	errorFormatter(options) {
		const {shape, error} = options
		return {
			...shape,
			data: {
				...shape.data,
				zodError: error.code === 'BAD_REQUEST' && error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		}
	},
})
export const router = t.router
const baseProcedure = t.procedure.use(websocketLogger)
export const publicProcedure = baseProcedure
export const accountProcedure = baseProcedure.use(isAuthenticated)
export const ownerProcedure = baseProcedure.use(isOwner)
// Existing authenticated procedures are owner-only. Keeping this alias avoids
// a noisy route migration while making the future account/owner boundary explicit.
export const privateProcedure = ownerProcedure
// Use this procedure type sparingly, it's for exposing endpoints that usually need authentication but
// may need to be used before a user is registered when a token can't exist. We shouldn't use it for
// everything because there could be edgecases where it gets applied like if the user file is corrupted.
export const publicProcedureWhenNoUserExists = baseProcedure.use(isAuthenticatedIfUserExists)
