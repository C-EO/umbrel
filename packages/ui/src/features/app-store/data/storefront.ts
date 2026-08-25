// Schema and resolution for the optional apps.umbrel.com storefront feed.
//
// The feed can only ever decorate the store: every app id is resolved against
// the local registry and silently dropped when unknown, unknown section types
// are ignored for forwards compatibility, and any malformed payload is treated
// exactly like having no remote data at all. No remote response can create an
// installable app, override a local version, or block a local route.

import {z} from 'zod'

import {APP_STORE_REMOTE_API_BASE} from '@/features/app-store/constants'
import {buildAppDates, type AppDates} from '@/features/app-store/data/catalog'
import type {RegistryApp} from '@/trpc/trpc'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const boundedString = (max: number) => z.string().trim().min(1).max(max)

// Comfortably above the production catalog/editorial layout while keeping a
// malformed feed from multiplying work during validation and reconciliation.
export const STOREFRONT_LIMITS = {
	sections: 32,
	sectionAppIds: 512,
	spotlightBanners: 24,
	categories: 64,
	categoryFeaturedAppIds: 24,
	appMetadata: 1024,
} as const

const appIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9-]+$/)

const appIdsSchema = z.array(appIdSchema).max(STOREFRONT_LIMITS.sectionAppIds)

// Artwork must come from the same origin as the API itself (apps.umbrel.com in
// production) so a bad feed can't turn devices into requesters of arbitrary
// third-party URLs.
const artworkUrlSchema = z
	.string()
	.max(1024)
	.refine((value) => {
		try {
			const url = new URL(value)
			const apiOrigin = new URL(APP_STORE_REMOTE_API_BASE).origin
			return url.origin === apiOrigin && (url.protocol === 'https:' || apiOrigin.startsWith('http://localhost'))
		} catch {
			return false
		}
	}, 'artwork must be hosted alongside the storefront API')

// umbrelOS is dark-only, so artwork is a single image
const artworkSchema = z.object({
	dark: artworkUrlSchema,
})

const sectionBaseSchema = z.object({
	id: boundedString(64),
	title: boundedString(80),
})

const appListSectionSchema = sectionBaseSchema.extend({
	type: z.literal('app-list'),
	layout: z.enum(['grid', 'rail']),
	subtitle: boundedString(40).optional(),
	appIds: appIdsSchema,
})

// One section of banners. Each banner is a complete editorial composition
// (the app's icon, name and headline are part of the image), so all a banner
// needs is the app it opens and its artwork.
const spotlightSectionSchema = z.object({
	id: boundedString(64),
	type: z.literal('spotlight'),
	banners: z.array(z.object({appId: appIdSchema, artwork: artworkSchema})).max(STOREFRONT_LIMITS.spotlightBanners),
})

const categoryFeatureSectionSchema = sectionBaseSchema.extend({
	type: z.literal('category-feature'),
	categoryId: boundedString(64),
	description: boundedString(300),
	appIds: appIdsSchema,
	artwork: artworkSchema,
	// Which side of the artwork is clear enough to place copy on
	textSide: z.enum(['left', 'right']).default('left'),
})

const knownSectionSchema = z.discriminatedUnion('type', [
	appListSectionSchema,
	spotlightSectionSchema,
	categoryFeatureSectionSchema,
])

export type StorefrontSection = z.infer<typeof knownSectionSchema>

const storefrontSchema = z.object({
	schemaVersion: z.literal(1),
	// Sections are validated individually below so a single malformed or
	// unknown-typed section drops that section, not the whole feed
	sections: z.array(z.unknown()).max(STOREFRONT_LIMITS.sections),
	categories: z
		.array(
			z.object({
				id: boundedString(64),
				featuredAppIds: z.array(appIdSchema).max(STOREFRONT_LIMITS.categoryFeaturedAppIds),
			}),
		)
		.max(STOREFRONT_LIMITS.categories)
		.default([]),
	apps: z
		.array(
			z.object({
				id: appIdSchema,
				version: boundedString(64),
				createdAt: z.string().max(64).nullish(),
				updatedAt: z.string().max(64).nullish(),
			}),
		)
		.max(STOREFRONT_LIMITS.appMetadata)
		.default([]),
})

export type Storefront = {
	sections: StorefrontSection[]
	categories: {id: string; featuredAppIds: string[]}[]
	apps: z.infer<typeof storefrontSchema>['apps']
}

/**
 * Parses the raw `data` payload of the storefront endpoint. Throws when the
 * envelope is malformed (the caller treats that as "no remote data");
 * individual sections that are malformed or of an unknown future type are
 * dropped silently.
 */
export function parseStorefront(data: unknown): Storefront {
	const parsed = storefrontSchema.parse(data)

	const sections: StorefrontSection[] = []
	for (const rawSection of parsed.sections) {
		const section = knownSectionSchema.safeParse(rawSection)
		if (section.success) sections.push(section.data)
	}

	return {sections, categories: parsed.categories, apps: parsed.apps}
}

// ---------------------------------------------------------------------------
// Resolution against the local registry
// ---------------------------------------------------------------------------

export type SpotlightBanner = {app: RegistryApp; artwork: {dark: string}}

export type ResolvedSection =
	| {type: 'app-list'; id: string; layout: 'grid' | 'rail'; title: string; subtitle?: string; apps: RegistryApp[]}
	| {type: 'spotlight'; id: string; banners: SpotlightBanner[]}
	| {
			type: 'category-feature'
			id: string
			categoryId: string
			title: string
			description: string
			apps: RegistryApp[]
			artwork: {dark: string}
			textSide: 'left' | 'right'
	  }

export type ResolvedStorefront = {
	sections: ResolvedSection[]
	/** Up to 6 locally available featured apps per category id */
	featuredByCategory: Map<string, RegistryApp[]>
	/** Reconciled creation/update dates for locally available apps */
	dates: Map<string, AppDates>
}

/**
 * Resolves a parsed feed against the local registry. Missing apps are dropped,
 * ids are deduplicated, and sections without enough locally available content
 * disappear entirely rather than rendering half-broken.
 */
export function resolveStorefront(
	storefront: Storefront,
	localAppsKeyed: Record<string, RegistryApp>,
	localCategories: Record<string, readonly unknown[]> = {},
): ResolvedStorefront {
	const resolveApps = (appIds: readonly string[]) => {
		const resolved: RegistryApp[] = []
		const seen = new Set<string>()
		for (const appId of appIds) {
			if (seen.has(appId)) continue
			seen.add(appId)
			const app = localAppsKeyed[appId]
			if (app) resolved.push(app)
		}
		return resolved
	}

	const sections: ResolvedSection[] = []
	for (const section of storefront.sections) {
		if (section.type === 'app-list') {
			const apps = resolveApps(section.appIds)
			if (apps.length === 0) continue
			sections.push({...section, apps})
		} else if (section.type === 'spotlight') {
			// Banners for apps this device doesn't know are dropped, one per app
			const banners: SpotlightBanner[] = []
			const seen = new Set<string>()
			for (const banner of section.banners) {
				const app = localAppsKeyed[banner.appId]
				if (!app || seen.has(app.id)) continue
				seen.add(app.id)
				banners.push({app, artwork: banner.artwork})
			}
			if (banners.length === 0) continue
			sections.push({type: 'spotlight', id: section.id, banners})
		} else if (section.type === 'category-feature') {
			const apps = resolveApps(section.appIds)
			const categoryHasLocalApps = (localCategories[section.categoryId]?.length ?? 0) > 0
			if (apps.length === 0 || !categoryHasLocalApps) continue
			sections.push({...section, apps})
		}
	}

	const featuredByCategory = new Map<string, RegistryApp[]>()
	for (const category of storefront.categories) {
		const apps = resolveApps(category.featuredAppIds)
		if (apps.length > 0) featuredByCategory.set(category.id, apps)
	}

	return {
		sections,
		featuredByCategory,
		dates: buildAppDates(storefront.apps, localAppsKeyed),
	}
}
