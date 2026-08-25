export const UMBREL_APP_STORE_ID = 'umbrel-app-store'

export type AppIdentity = {
	registryId: string
	appId: string
}

export function appPath(appId: string) {
	return `/app-store/${appId}`
}

export function communityAppPath(registryId: string, appId: string) {
	return `/community-app-store/${registryId}/${appId}`
}

export function appPathForIdentity({registryId, appId}: AppIdentity) {
	return registryId === UMBREL_APP_STORE_ID ? appPath(appId) : communityAppPath(registryId, appId)
}

export function registryAppPath(app: {appStoreId: string; id: string}) {
	return appPathForIdentity({registryId: app.appStoreId, appId: app.id})
}
