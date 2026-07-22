import assert from 'node:assert/strict'
import test from 'node:test'

import {
	AUTH_TOKEN_LOCAL_STORAGE_KEY,
	AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY,
	clearAuthToken,
	startTokenRenewal,
	storeAuthToken,
} from './token-renewal.ts'

const ONE_HOUR = 60 * 60 * 1000

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

function createRenewal(
	storage: MemoryStorage,
	renewToken: () => Promise<string>,
	now: () => number,
	overrides: Partial<Parameters<typeof startTokenRenewal>[0]> = {},
) {
	return startTokenRenewal({
		storage,
		interval: ONE_HOUR,
		renewToken,
		now,
		onPageReady: () => {},
		schedule: () => {},
		...overrides,
	})
}

test('renews a stale session and records completion time without changing its credential', async () => {
	const storage = new MemoryStorage()
	let now = 2 * ONE_HOUR
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'old-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, String(now - ONE_HOUR - 1))

	const renewal = createRenewal(
		storage,
		async () => {
			now += 250
			return 'old-token'
		},
		() => now,
	)

	assert.equal(await renewal.renewIfDue(), true)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), 'old-token')
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), String(now))
})

test('does not advance the timestamp when renewal fails', async () => {
	const storage = new MemoryStorage()
	const now = 2 * ONE_HOUR
	const previousRefresh = String(now - ONE_HOUR - 1)
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'old-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, previousRefresh)

	let attempts = 0
	const renewal = createRenewal(
		storage,
		async () => {
			attempts += 1
			if (attempts === 1) throw new Error('network unavailable')
			return 'old-token'
		},
		() => now,
	)

	await assert.rejects(renewal.renewIfDue(), /network unavailable/)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), 'old-token')
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), previousRefresh)

	assert.equal(await renewal.renewIfDue(), true)
	assert.equal(attempts, 2)
})

test('anonymous loads do not suppress renewal state and old browser values remain untouched', async () => {
	const storage = new MemoryStorage()
	const now = 2 * ONE_HOUR
	storage.setItem('jwt', 'unused-old-value')

	let attempts = 0
	const renewal = createRenewal(
		storage,
		async () => {
			attempts += 1
			return 'login-token'
		},
		() => now,
	)

	assert.equal(await renewal.renewIfDue(), false)
	assert.equal(attempts, 0)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)

	storeAuthToken(storage, 'new-login-token', now)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), 'new-login-token')
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), String(now))
	assert.equal(storage.getItem('jwt'), 'unused-old-value')
	assert.equal(await renewal.renewIfDue(), false)

	clearAuthToken(storage)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem('jwt'), 'unused-old-value')
})

test('an open page retries renewal on the hourly schedule', async () => {
	const storage = new MemoryStorage()
	let now = ONE_HOUR
	storeAuthToken(storage, 'login-token', now)

	let onPageReady: (() => Promise<boolean>) | undefined
	let scheduledAttempt: (() => Promise<boolean>) | undefined
	let scheduledInterval: number | undefined
	let attempts = 0

	createRenewal(
		storage,
		async () => {
			attempts += 1
			return 'login-token'
		},
		() => now,
		{
			onPageReady: (callback) => {
				onPageReady = callback
			},
			schedule: (callback, interval) => {
				scheduledAttempt = callback
				scheduledInterval = interval
			},
		},
	)

	assert.equal(await onPageReady!(), false)
	assert.equal(attempts, 0)
	assert.equal(scheduledInterval, ONE_HOUR)

	now += ONE_HOUR
	assert.equal(await scheduledAttempt!(), true)
	assert.equal(attempts, 1)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), 'login-token')
})

test('deduplicates simultaneous renewal attempts', async () => {
	const storage = new MemoryStorage()
	const now = 2 * ONE_HOUR
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'login-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, String(now - ONE_HOUR - 1))

	let attempts = 0
	let finishRenewal: (() => void) | undefined
	const renewal = createRenewal(
		storage,
		() => {
			attempts += 1
			return new Promise<string>((resolve) => {
				finishRenewal = () => resolve('login-token')
			})
		},
		() => now,
	)

	const first = renewal.renewIfDue()
	const second = renewal.renewIfDue()
	assert.equal(attempts, 1)
	finishRenewal!()
	assert.deepEqual(await Promise.all([first, second]), [true, true])
	assert.equal(attempts, 1)
})

test('does not restore a token when logout wins a renewal race', async () => {
	const storage = new MemoryStorage()
	const now = 2 * ONE_HOUR
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'login-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, String(now - ONE_HOUR - 1))

	let finishRenewal: (() => void) | undefined
	const renewal = createRenewal(
		storage,
		() =>
			new Promise<string>((resolve) => {
				finishRenewal = () => resolve('login-token')
			}),
		() => now,
	)

	const inFlight = renewal.renewIfDue()
	clearAuthToken(storage)
	finishRenewal!()

	assert.equal(await inFlight, false)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)
})

test('renews after the browser clock moves behind the saved timestamp', async () => {
	const storage = new MemoryStorage()
	const now = ONE_HOUR
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'login-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, String(2 * ONE_HOUR))

	let attempts = 0
	const renewal = createRenewal(
		storage,
		async () => {
			attempts += 1
			return 'login-token'
		},
		() => now,
	)

	assert.equal(await renewal.renewIfDue(), true)
	assert.equal(attempts, 1)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), String(now))
})
