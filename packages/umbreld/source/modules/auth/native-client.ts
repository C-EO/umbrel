import {z} from 'zod'

// These are identifiers, not an allowlist. Recognition belongs in the UI so a
// new native client can authenticate without waiting for an umbrelOS release.
const identifier = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
const version = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[^\u0000-\u001f\u007f]+$/)

export const nativeClientSchema = z.object({
	id: identifier,
	platform: identifier,
	deviceClass: identifier,
	appVersion: version,
	appBuild: version,
	osVersion: version,
})

export type NativeClient = z.infer<typeof nativeClientSchema>
