// Schema and reconciliation for the optional per-app release history from
// apps.umbrel.com.
//
// The local registry's current version and release notes remain authoritative:
// remote history is only accepted for the same app and only shown when its
// current version matches the local one, so a feed that is ahead of the local
// registry can never present releases as if they were installable. Any failure
// falls back to the local current release notes.

import {queryOptions} from '@tanstack/react-query'
import {z} from 'zod'

import {APP_STORE_REMOTE_API_BASE} from '@/features/app-store/constants'
import {remoteJsonFetcher} from '@/features/app-store/data/storefront-query'
import type {RegistryApp} from '@/trpc/trpc'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const appReleasesSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string().min(1).max(64),
	version: z.string().min(1).max(64),
	releases: z
		.array(
			z.object({
				version: z.string().min(1).max(64),
				date: z.string().max(64).nullish(),
				notes: z.string().max(10000),
			}),
		)
		.max(5),
})

export type AppReleases = z.infer<typeof appReleasesSchema>

export function parseAppReleases(data: unknown): AppReleases {
	return appReleasesSchema.parse(data)
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function appReleasesQueryOptions(appId: string) {
	return queryOptions<AppReleases>({
		queryKey: ['app-store', 'app-releases', appId],
		queryFn: async ({signal}) => {
			const json = (await remoteJsonFetcher(`${APP_STORE_REMOTE_API_BASE}/apps/${encodeURIComponent(appId)}`)({
				signal,
			})) as {data?: unknown}
			return parseAppReleases(json?.data)
		},
		retry: false,
		staleTime: 60 * 60 * 1000,
	})
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReleaseTimelineEntry = {
	version: string
	/** Epoch ms; undefined when only local data is available */
	date?: number
	notes: string
}

/**
 * Merges remote release history with the authoritative local release info.
 *
 * - Remote data for a different app id or a mismatched current version is
 *   discarded entirely (the feed may be ahead of or behind this device).
 * - When accepted, entries newer than the local current version are dropped
 *   and the newest entry's notes fall back to the local release notes if the
 *   remote ones are empty.
 * - With no usable remote data the timeline is the local current release only.
 */
/** A single undated entry without notes isn't worth a "What's new" card */
export function hasTimelineContent(entries: readonly ReleaseTimelineEntry[]): boolean {
	const [latest] = entries
	if (!latest) return false
	return entries.length > 1 || latest.date !== undefined || Boolean(latest.notes.trim())
}

export function reconcileReleases(
	app: Pick<RegistryApp, 'id' | 'version' | 'releaseNotes'>,
	remote: AppReleases | undefined,
): ReleaseTimelineEntry[] {
	const localOnly: ReleaseTimelineEntry[] = [{version: app.version, notes: app.releaseNotes ?? ''}]

	if (!remote || remote.id !== app.id || remote.version !== app.version) return localOnly

	// Drop any entries the feed claims are newer than what this device can
	// install; the first remaining entry should describe the local version.
	const startIndex = remote.releases.findIndex((release) => release.version === app.version)
	if (startIndex === -1) return localOnly

	const entries = remote.releases.slice(startIndex).map((release, index) => {
		const date = release.date ? Date.parse(release.date) : Number.NaN
		return {
			version: release.version,
			date: Number.isNaN(date) ? undefined : date,
			notes: index === 0 && !release.notes.trim() ? (app.releaseNotes ?? '') : release.notes,
		}
	})

	return entries.length > 0 ? entries : localOnly
}
