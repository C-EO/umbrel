// @vitest-environment jsdom

import {describe, expect, it} from 'vitest'

import {resolveRedirectUrl} from '@/modules/auth/redirect-url'

const origin = 'https://umbrel.local'

describe('resolveRedirectUrl', () => {
	it('preserves same-origin paths, searches, and hashes', () => {
		expect(resolveRedirectUrl('/settings/users?tab=apps#shared', origin).toString()).toBe(
			`${origin}/settings/users?tab=apps#shared`,
		)
	})

	it.each([
		['absolute URL', 'https://evil.example/path'],
		['protocol-relative URL', '//evil.example/path'],
		['slash-backslash URL', String.raw`/\evil.example/path`],
		['login loop', '/login?redirect=%2Fsettings'],
	])('falls back to home for a %s', (_label, target) => {
		expect(resolveRedirectUrl(target, origin).toString()).toBe(`${origin}/`)
	})

	it('rejects a slash-backslash target after query-string decoding', () => {
		const target = new URLSearchParams('redirect=%2F%5Cevil.example%2Fpath').get('redirect') ?? ''
		expect(resolveRedirectUrl(target, origin).toString()).toBe(`${origin}/`)
	})
})
