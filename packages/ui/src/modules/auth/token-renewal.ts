export const AUTH_TOKEN_LOCAL_STORAGE_KEY = 'umbrel-auth-token'
export const AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY = 'auth-token-last-refreshed'

type AuthTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StartTokenRenewalOptions = {
	storage: AuthTokenStorage
	interval: number
	renewToken: () => Promise<string>
	now?: () => number
	onPageReady?: (callback: () => Promise<boolean>) => void
	schedule?: (callback: () => Promise<boolean>, interval: number) => void
}

export function storeAuthToken(storage: AuthTokenStorage, token: string, refreshedAt = Date.now()) {
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, token)
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, refreshedAt.toString())
}

export function clearAuthToken(storage: AuthTokenStorage) {
	storage.removeItem(AUTH_TOKEN_LOCAL_STORAGE_KEY)
	storage.removeItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY)
}

export function startTokenRenewal({
	storage,
	interval,
	renewToken,
	now = Date.now,
	onPageReady = (callback) => {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => void callback(), {once: true})
		} else {
			void callback()
		}
	},
	schedule = (callback, interval) => {
		setInterval(() => void callback(), interval)
	},
}: StartTokenRenewalOptions) {
	let renewalInFlight: Promise<boolean> | undefined

	async function renewIfDue() {
		if (renewalInFlight) return renewalInFlight
		const tokenAtStart = storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY)
		if (!tokenAtStart) return false

		const lastRefreshedAtValue = storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY)
		const lastRefreshedAt = Number(lastRefreshedAtValue)
		if (lastRefreshedAtValue && Number.isFinite(lastRefreshedAt)) {
			const elapsed = now() - lastRefreshedAt
			if (elapsed >= 0 && elapsed < interval) return false
		}

		const renewal = (async () => {
			const token = await renewToken()
			// A logout or a newer login may have happened while the request was in
			// flight (including in another tab). Never restore or overwrite that state.
			if (storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY) !== tokenAtStart) return false
			storeAuthToken(storage, token, now())
			return true
		})()
		renewalInFlight = renewal

		try {
			return await renewal
		} finally {
			if (renewalInFlight === renewal) renewalInFlight = undefined
		}
	}

	// Timer callbacks deliberately swallow renewal failures. A failed attempt
	// leaves the timestamp untouched, so the next page load or interval retries.
	const attemptRenewal = () => renewIfDue().catch(() => false)
	onPageReady(attemptRenewal)
	schedule(attemptRenewal, interval)

	return {renewIfDue}
}
