export const CLOUD_PROVIDER_IDS = ['google-drive', 'dropbox', 'onedrive', 'webdav', 'icloud'] as const
export const CLOUD_WEBDAV_FLAVOR_IDS = ['webdav', 'nextcloud', 'owncloud'] as const
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type Provider = (typeof CLOUD_PROVIDER_IDS)[number]
export type WebDavFlavor = (typeof CLOUD_WEBDAV_FLAVOR_IDS)[number]

export const CLOUD_ACCOUNT_NOT_FOUND_ERROR = '[cloud-account-not-found]'
export const CLOUD_DESTINATION_MISSING_ERROR = '[cloud-destination-missing]'
export const CLOUD_INVALID_ACCOUNT_CONFIG_ERROR = '[cloud-invalid-account-config]'
export const CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR = '[cloud-invalid-account-identity]'

// Files hidden as OS junk must also be excluded from the cloud mirror.
// Otherwise rclone sees a hidden local file as destination-only and deletes it.
export const OS_JUNK_BASENAMES = [
	'.DS_Store',
	'.directory',
	'.umbrel-watcher-health-check',
	'Thumbs.db',
	'desktop.ini',
] as const
export const OS_JUNK_PREFIXES = ['._'] as const

export const isOsJunkBasename = (basename: string) =>
	OS_JUNK_BASENAMES.some((junk) => basename === junk) || OS_JUNK_PREFIXES.some((prefix) => basename.startsWith(prefix))

export const CLOUD_SYNC_MODE_IDS = ['one-time', 'auto'] as const

export type CloudSyncMode = (typeof CLOUD_SYNC_MODE_IDS)[number]

export type ProviderConnection =
	| {kind: 'oauth'}
	| {
			kind: 'webdav'
			flavor: WebDavFlavor
			url: string
			username: string
			tlsMode: 'default' | 'insecure'
	  }
	| {kind: 'icloud'; appleId: string}

export type Account = {
	id: string
	userId: string
	provider: Provider
	identity: string
	displayName: string
	connection: ProviderConnection
}

// Provider and destination category are deliberately not persisted here. They
// are derived from Account.provider and the canonical Files path respectively.
export type RemoteRef = {
	path: string
	folderId?: string
	sharedDriveId?: string
	driveId?: string
	driveType?: 'personal' | 'business'
}

export type DestinationRef = {
	path: string
	filesystemUuid?: string
	host?: string
	share?: string
}

export type CloudSync = {
	id: string
	accountId: string
	remote: RemoteRef
	destination: DestinationRef
	mode: CloudSyncMode
	pauseReasons?: {user?: true; restore?: true}
	lastSuccessfulAt?: number
}

export type CloudStore = {
	accounts: Account[]
	syncs: CloudSync[]
}

export const createEmptyCloudStore = (): CloudStore => ({accounts: [], syncs: []})

export type AccountAttention = {kind: 'auth'} | {kind: 'quota'}

export type CloudSyncAttention = {kind: 'destination-missing'} | {kind: 'error'; message?: string}

export type CloudSyncState = 'paused' | 'running' | 'queued' | 'needs-attention' | 'idle'

export type CloudSyncActivity = {
	syncId: string
	percent?: number
	bytesPerSecond: number
	transferredFiles: number
	totalFiles?: number
	transferredBytes: number
	totalBytes?: number
}

export type CloudSyncStatus = {
	state: CloudSyncState
	attention?: AccountAttention | CloudSyncAttention
	nextRunAt?: number
	activity?: CloudSyncActivity
}

export type CloudProviderMetadata = {
	id: Provider
	displayName: string
	connectionKind: ProviderConnection['kind']
}

export const CLOUD_PROVIDERS: CloudProviderMetadata[] = [
	{
		id: 'google-drive',
		displayName: 'Google Drive',
		connectionKind: 'oauth',
	},
	{
		id: 'dropbox',
		displayName: 'Dropbox',
		connectionKind: 'oauth',
	},
	{
		id: 'onedrive',
		displayName: 'OneDrive',
		connectionKind: 'oauth',
	},
	{
		id: 'webdav',
		displayName: 'WebDAV',
		connectionKind: 'webdav',
	},
	{
		id: 'icloud',
		displayName: 'iCloud Drive',
		connectionKind: 'icloud',
	},
]

export const CLOUD_JUNK_FILTER_PATTERNS = [
	...OS_JUNK_BASENAMES,
	...OS_JUNK_PREFIXES.map((prefix) => `${prefix}*`),
] as const

export const CLOUD_JUNK_FILTER = `${CLOUD_JUNK_FILTER_PATTERNS.map((pattern) => `- ${pattern}`).join('\n')}\n`
