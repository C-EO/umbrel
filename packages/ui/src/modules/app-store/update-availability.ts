import type {RegistryApp} from '@/trpc/trpc'

export function isAppUpdateAvailable(installedVersion: string, availableApp?: RegistryApp) {
	return availableApp !== undefined && availableApp.version !== installedVersion
}
