import {expect, test} from 'vitest'

import {sanitizeRegistry} from './app-store.js'

test('public registry excludes repository locations and undeclared manifest fields', () => {
	const registry = [
		{
			url: 'https://user:secret@example.internal/private-store.git?token=secret',
			meta: {id: 'community', name: 'Community', internal: 'not public'},
			apps: [
				{
					appStoreId: 'community',
					manifestVersion: '1.0.0',
					id: 'community-example',
					name: 'Example',
					tagline: 'An example app',
					icon: 'https://example.com/icon.svg',
					category: 'Utilities',
					version: '1.2.3',
					port: 3000,
					description: 'Description',
					website: 'https://example.com',
					repo: 'https://example.com/source',
					support: 'https://example.com/support',
					gallery: ['https://example.com/screenshot.png'],
					defaultPassword: 'manifest-password',
					path: '/admin',
					privateExtension: {token: 'manifest-secret'},
				},
			],
		},
	] as unknown as Parameters<typeof sanitizeRegistry>[0]

	const sanitized = sanitizeRegistry(registry)

	expect(sanitized).toHaveLength(1)
	expect(sanitized[0].meta).toStrictEqual({id: 'community', name: 'Community'})
	expect(sanitized[0]).not.toHaveProperty('url')
	expect(sanitized[0].apps[0]).toMatchObject({
		appStoreId: 'community',
		id: 'community-example',
		name: 'Example',
		repo: 'https://example.com/source',
	})
	expect(sanitized[0].apps[0]).not.toHaveProperty('port')
	expect(sanitized[0].apps[0]).not.toHaveProperty('path')
	expect(sanitized[0].apps[0]).not.toHaveProperty('defaultPassword')
	expect(sanitized[0].apps[0]).not.toHaveProperty('privateExtension')
})
