import {z} from 'zod'

export const MACHINE_ID_MAX_LENGTH = 63
export const machineIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const machineIdSchema = z.string().max(MACHINE_ID_MAX_LENGTH).regex(machineIdPattern)

export function slugifyMachineId(value: string) {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, MACHINE_ID_MAX_LENGTH)
			.replace(/-+$/g, '') || 'machine'
	)
}

export function machineIdCandidate(base: string, attempt: number) {
	if (!Number.isInteger(attempt) || attempt < 1) throw new Error('[machine-id-attempt-invalid]')
	if (attempt === 1) return machineIdSchema.parse(base)
	const suffix = `-${attempt}`
	const prefix = base.slice(0, MACHINE_ID_MAX_LENGTH - suffix.length).replace(/-+$/g, '') || 'machine'
	return machineIdSchema.parse(`${prefix}${suffix}`)
}
