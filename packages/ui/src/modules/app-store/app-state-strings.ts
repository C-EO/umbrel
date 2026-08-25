import type {TFunction} from 'i18next'

import type {AppState} from '@/trpc/trpc'

/** The user-facing label for an app's lifecycle state (buttons, status rows, cmdk) */
export function appStateToString(appState: AppState, t: TFunction) {
	return {
		'not-installed': t('app.install'),
		installing: t('app.installing'),
		ready: t('app.open'),
		running: t('app.open'),
		starting: t('app.starting'),
		restarting: t('app.restarting'),
		stopping: t('app.stopping'),
		updating: t('app.updating'),
		uninstalling: t('app.uninstalling'),
		unknown: t('app.offline'),
		stopped: t('app.offline'),
		loading: t('loading'),
	}[appState]
}
