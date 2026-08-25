import {arrayIncludes} from 'ts-extras'

import type {AppStateOrLoading, RegistryApp} from '@/trpc/trpc'

export function isAppUpdateAvailable(installedVersion: string, availableApp?: RegistryApp) {
	return availableApp !== undefined && availableApp.version !== installedVersion
}

/** Whether a settled app can offer an update action to the user. */
export function canPresentUpdateAction(state: AppStateOrLoading) {
	return arrayIncludes(['ready', 'running', 'stopped', 'unknown'] as const, state)
}

/** Whether the update mutation itself is safe to execute. */
export function canExecuteUpdate(state: AppStateOrLoading, compatible: boolean) {
	return compatible && canPresentUpdateAction(state)
}
