// @vitest-environment jsdom
import {describe, expect, test, vi} from 'vitest'

import {APP_STORE_REMOTE_API_BASE} from '@/features/app-store/constants'
import type {RegistryApp} from '@/trpc/trpc'

import {parseStorefront, resolveStorefront, STOREFRONT_LIMITS, type Storefront} from './storefront'

vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))

// Artwork must be hosted alongside the API, so build fixture URLs from the
// configured base — the tests then hold for both the production and the
// temporary local-development API base.
const artworkUrl = `${new URL(APP_STORE_REMOTE_API_BASE).origin}/images/redesign/banners/banner-openclaw.webp`
const artwork = {dark: artworkUrl}

const validFeed = {
	schemaVersion: 1,
	sections: [
		{id: 'rail', type: 'app-list', layout: 'rail', title: 'Serving hot now', subtitle: 'Featured', appIds: ['a', 'b']},
		{id: 'spot', type: 'spotlight', banners: [{appId: 'a', artwork}]},
		{
			id: 'cat',
			type: 'category-feature',
			categoryId: 'ai',
			title: 'AI at home',
			description: 'Desc',
			appIds: ['a', 'b', 'c'],
			artwork,
		},
	],
	categories: [{id: 'ai', featuredAppIds: ['a', 'missing']}],
	apps: [
		{id: 'a', version: '1.0.0', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'},
		{id: 'b', version: '9.9.9', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z'},
	],
}

describe('parseStorefront', () => {
	test('accepts a valid feed', () => {
		const storefront = parseStorefront(validFeed)
		expect(storefront.sections).toHaveLength(3)
		expect(storefront.categories).toHaveLength(1)
		expect(storefront.apps).toHaveLength(2)
	})

	test('silently drops unknown future section types and malformed sections', () => {
		const storefront = parseStorefront({
			...validFeed,
			sections: [
				...validFeed.sections,
				{id: 'future', type: 'video-hero', title: 'New hotness', videoUrl: 'https://apps.umbrel.com/x.mp4'},
				{id: 'broken', type: 'app-list', layout: 'grid', title: '', appIds: []},
			],
		})
		expect(storefront.sections.map(({id}) => id)).toEqual(['rail', 'spot', 'cat'])
	})

	test('rejects malformed envelopes', () => {
		expect(() => parseStorefront(undefined)).toThrow()
		expect(() => parseStorefront({schemaVersion: 2, sections: []})).toThrow()
		expect(() => parseStorefront('<!doctype html>')).toThrow()
	})

	test('rejects artwork not hosted alongside the API', () => {
		const storefront = parseStorefront({
			...validFeed,
			sections: [
				{
					id: 'spot',
					type: 'spotlight',
					banners: [{appId: 'a', artwork: {dark: 'https://evil.example/x.png'}}],
				},
			],
		})
		expect(storefront.sections).toHaveLength(0)
	})

	test.each([
		['sections', {...validFeed, sections: Array.from({length: STOREFRONT_LIMITS.sections + 1}, () => null)}],
		[
			'categories',
			{
				...validFeed,
				categories: Array.from({length: STOREFRONT_LIMITS.categories + 1}, (_, index) => ({
					id: `category-${index}`,
					featuredAppIds: [],
				})),
			},
		],
		[
			'app metadata',
			{
				...validFeed,
				apps: Array.from({length: STOREFRONT_LIMITS.appMetadata + 1}, (_, index) => ({
					id: `app-${index}`,
					version: '1.0.0',
				})),
			},
		],
	] as const)('rejects oversized top-level %s collections', (_name, feed) => {
		expect(() => parseStorefront(feed)).toThrow()
	})

	test('drops sections with oversized app or banner collections', () => {
		const storefront = parseStorefront({
			...validFeed,
			sections: [
				{
					id: 'apps',
					type: 'app-list',
					layout: 'grid',
					title: 'Apps',
					appIds: Array.from({length: STOREFRONT_LIMITS.sectionAppIds + 1}, () => 'a'),
				},
				{
					id: 'spotlight',
					type: 'spotlight',
					banners: Array.from({length: STOREFRONT_LIMITS.spotlightBanners + 1}, () => ({appId: 'a', artwork})),
				},
			],
		})

		expect(storefront.sections).toEqual([])
	})

	test('rejects oversized category featured-app collections', () => {
		expect(() =>
			parseStorefront({
				...validFeed,
				categories: [
					{
						id: 'ai',
						featuredAppIds: Array.from({length: STOREFRONT_LIMITS.categoryFeaturedAppIds + 1}, () => 'a'),
					},
				],
			}),
		).toThrow()
	})
})

describe('resolveStorefront', () => {
	const localApps: Record<string, RegistryApp> = {
		a: {id: 'a', name: 'A', version: '1.0.0'} as RegistryApp,
		b: {id: 'b', name: 'B', version: '2.0.0'} as RegistryApp,
	}
	const localCategories = {ai: [{}]}

	const storefront = (overrides: Partial<Storefront> = {}): Storefront => ({
		...parseStorefront(validFeed),
		...overrides,
	})

	test('resolves ids against the local registry and drops missing apps', () => {
		const resolved = resolveStorefront(storefront(), localApps, localCategories)

		const categoryFeature = resolved.sections.find(({type}) => type === 'category-feature')
		expect(categoryFeature && 'apps' in categoryFeature && categoryFeature.apps.map(({id}) => id)).toEqual(['a', 'b'])
	})

	test('deduplicates repeated ids', () => {
		const resolved = resolveStorefront(
			storefront({
				sections: [{id: 'rail', type: 'app-list', layout: 'rail', title: 'Rail', appIds: ['a', 'a', 'b']}],
			}),
			localApps,
			localCategories,
		)

		const rail = resolved.sections[0]
		expect(rail && 'apps' in rail && rail.apps.map(({id}) => id)).toEqual(['a', 'b'])
	})

	test('drops sections without enough locally available content', () => {
		const resolved = resolveStorefront(
			storefront({
				sections: [
					{id: 'rail', type: 'app-list', layout: 'rail', title: 'Rail', appIds: ['missing']},
					{id: 'spot', type: 'spotlight', banners: [{appId: 'missing', artwork}]},
					{
						id: 'cat-no-local-category',
						type: 'category-feature',
						categoryId: 'gaming',
						title: 'T',
						description: 'D',
						appIds: ['a'],
						artwork,
						textSide: 'left',
					},
				],
			}),
			localApps,
			localCategories,
		)

		expect(resolved.sections).toHaveLength(0)
	})

	test('spotlight keeps one banner per locally available app', () => {
		const resolved = resolveStorefront(
			storefront({
				sections: [
					{
						id: 'spot',
						type: 'spotlight',
						banners: [
							{appId: 'missing', artwork},
							{appId: 'b', artwork},
							{appId: 'a', artwork},
							{appId: 'b', artwork},
						],
					},
				],
			}),
			localApps,
			localCategories,
		)

		const spotlight = resolved.sections[0]
		expect(spotlight && 'banners' in spotlight && spotlight.banners.map(({app}) => app.id)).toEqual(['b', 'a'])
	})

	test('featured categories drop unknown apps; dates gate updatedAt on version match', () => {
		const resolved = resolveStorefront(storefront(), localApps, localCategories)

		expect(resolved.featuredByCategory.get('ai')?.map(({id}) => id)).toEqual(['a'])

		// App a: versions match — both dates. App b: remote 9.9.9 vs local 2.0.0 — createdAt only.
		expect(resolved.dates.get('a')).toEqual({
			createdAt: Date.parse('2024-01-01T00:00:00Z'),
			updatedAt: Date.parse('2026-01-01T00:00:00Z'),
		})
		expect(resolved.dates.get('b')).toEqual({createdAt: Date.parse('2025-01-01T00:00:00Z')})
	})
})
