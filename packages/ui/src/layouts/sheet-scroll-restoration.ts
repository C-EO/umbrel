import type {NavigationType} from 'react-router-dom'

import type {ScrollRestorationAction} from '@/hooks/use-scroll-restoration'

const isSettingsPath = (pathname: string) => /^\/settings(\/|$)/.test(pathname)

export function getSheetScrollRestorationAction(
	thisPathname: string,
	prevPathname: string,
	navigationType: NavigationType,
): ScrollRestorationAction {
	// Settings owns its desktop scroll position internally. Reset the shared
	// Sheet viewport when entering Settings, but leave it alone while opening a
	// nested Settings route or dialog.
	if (isSettingsPath(thisPathname)) return isSettingsPath(prevPathname) ? 'ignore' : 'reset'

	// Reset scroll position to zero unless going back in history.
	if (navigationType !== 'POP') return 'reset'

	// In App Store, restore position when navigating back from an app.
	if (/^\/app-store(\/|$)/.test(thisPathname)) {
		const cameFromApp = /^\/app-store\/[^/]+$/.test(prevPathname)
		return cameFromApp ? 'restore' : 'reset'
	}

	return 'reset'
}
