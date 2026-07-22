import assert from 'node:assert/strict'
import test from 'node:test'

import {finishLogout, finishLogoutOnUnauthorized} from './logout.ts'
import {describeSessionUserAgent, sessionDeviceType} from './session-user-agent.ts'
import {AUTH_TOKEN_LOCAL_STORAGE_KEY, AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY} from './token-renewal.ts'

class MemoryStorage {
	#values = new Map<string, string>()

	getItem(key: string) {
		return this.#values.get(key) ?? null
	}

	setItem(key: string, value: string) {
		this.#values.set(key, value)
	}

	removeItem(key: string) {
		this.#values.delete(key)
	}
}

test('finishing a current-session revocation clears auth state before navigating to login', () => {
	const storage = new MemoryStorage()
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'dashboard-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, '1234')
	const redirects: string[] = []

	finishLogout(storage, (path) => redirects.push(path))

	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)
	assert.deepEqual(redirects, ['/login'])
})

test('an unauthorized WS ticket response clears a stale session instead of retrying forever', () => {
	const storage = new MemoryStorage()
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'revoked-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, '1234')
	const redirects: string[] = []

	assert.equal(
		finishLogoutOnUnauthorized({data: {code: 'UNAUTHORIZED'}}, storage, (path) => redirects.push(path)),
		true,
	)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)
	assert.deepEqual(redirects, ['/login'])

	assert.equal(
		finishLogoutOnUnauthorized({data: {code: 'BAD_REQUEST'}}, storage, () => {}),
		false,
	)
})

test('describes common browser and device user agents without exposing version noise', () => {
	assert.equal(
		describeSessionUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
		),
		'Microsoft Edge on Windows',
	)
	assert.equal(
		describeSessionUserAgent(
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
		),
		'Safari on iOS',
	)
	assert.equal(describeSessionUserAgent('UmbrelDesktop/1.0'), 'UmbrelDesktop')
	assert.equal(describeSessionUserAgent(undefined), undefined)
})

test('classifies mobile, desktop, and missing user agents for session icons', () => {
	assert.equal(sessionDeviceType('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile'), 'mobile')
	assert.equal(sessionDeviceType('Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0'), 'desktop')
	assert.equal(sessionDeviceType(undefined), 'unknown')
})
