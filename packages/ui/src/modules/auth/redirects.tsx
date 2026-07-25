import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {resolveRedirectUrl} from '@/modules/auth/redirect-url'
import {IS_DEV, sleep} from '@/utils/misc'

const SLEEP_TIME = IS_DEV ? 600 : 0

type Page = 'onboarding' | 'login' | 'home' | 'raid-error'

const pageToPath = (page: Page) => {
	switch (page) {
		case 'onboarding':
			return '/onboarding'
		case 'login':
			return '/login'
		case 'home':
			return '/'
		case 'raid-error':
			return '/raid-error'
	}
}

export function RedirectOnboarding() {
	const {t} = useTranslation()
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('onboarding')
	const shouldRedirect = !location.pathname.startsWith(path)

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() => navigate(path))
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-onboarding')}</BareCoverMessage>
}

export function RedirectLogin() {
	const {t} = useTranslation()
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('login')
	const shouldRedirect = !location.pathname.startsWith(path)
	// Snapshot the destination from the router location at render time — the
	// delayed navigation below must never re-read the URL after it has changed
	const search = redirect.createRedirectSearch(location)

	useEffect(() => {
		if (!shouldRedirect) return
		// Cancellable: StrictMode double-runs this effect, and an uncancelled
		// second navigation would fire after the first landed on /login,
		// snapshotting /login itself into ?redirect= and losing the destination
		let cancelled = false
		sleep(SLEEP_TIME).then(() => {
			if (!cancelled) navigate({pathname: path, search})
		})
		return () => {
			cancelled = true
		}
	}, [shouldRedirect, navigate, path, search])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-login')}</BareCoverMessage>
}

export function RedirectHome() {
	const {t} = useTranslation()
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('home')
	const shouldRedirect = location.pathname !== path

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() => navigate(path))
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-home')}</BareCoverMessage>
}

export function RedirectRaidError() {
	const {t} = useTranslation()
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('raid-error')
	const shouldRedirect = !location.pathname.startsWith(path)

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() => navigate(path))
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-raid-error')}</BareCoverMessage>
}

export const redirect = {
	/** Builds `?redirect=` from the router location that triggered the redirect */
	createRedirectSearch(location: {pathname: string; search: string}) {
		const target = location.pathname + location.search
		// '/' is already the post-login default (noise), /login would loop
		if (target === '/' || target.startsWith('/login')) return ''
		return `?redirect=${encodeURIComponent(target)}`
	},
	getRedirectUrl() {
		const target = new URLSearchParams(window.location.search).get('redirect') || '/'
		return resolveRedirectUrl(target, window.location.origin)
	},
}
