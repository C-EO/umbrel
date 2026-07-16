import {privateProcedure, router} from '../server/trpc/trpc.js'

export default router({
	getCertificateStatus: privateProcedure.query(async ({ctx}) => ctx.umbreld.lanIngress.getCertificateStatus()),
	resetCa: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.lanIngress.resetCa()),
})
