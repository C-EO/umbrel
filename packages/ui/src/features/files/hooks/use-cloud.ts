import {keepPreviousData} from '@tanstack/react-query'
import {useCallback, useEffect, useRef, useState} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcReact, type RouterError, type RouterInput, type RouterOutput} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {getFilesErrorMessage} from '../utils/error-messages'

export type CloudSync = RouterOutput['files']['cloud']['syncs'][number]
export type CloudSyncStatus = CloudSync['status']
export type CloudSyncActivity = NonNullable<CloudSyncStatus['activity']>
export type CloudAccount = RouterOutput['files']['cloud']['accounts'][number]
export type CloudProvider = RouterOutput['files']['cloud']['providers'][number]
export type CloudSyncRemote = RouterInput['files']['cloud']['create']['remote']
export type CloudSyncDestination = RouterInput['files']['cloud']['create']['destination']
export type CloudSyncMode = RouterInput['files']['cloud']['create']['mode']
export type CloudLocations = RouterOutput['files']['cloud']['locations']
export type CloudBrowseResult = RouterOutput['files']['cloud']['browse']
export type CloudOAuthProvider = RouterInput['files']['cloud']['oauthBegin']['provider']
export type CloudRestoreWorkItem = RouterInput['files']['cloud']['restore']['workItems'][number]

// Sync ids removed through the UI (remove download / disconnect account). The
// completion toast must not fire for these when their records disappear.
const removedSyncIds = new Set<string>()

export function wasSyncRemovedByUser(syncId: string) {
	return removedSyncIds.has(syncId)
}

// The folder name a cloud is presented as everywhere in the UI
export function cloudSyncName(cloud: CloudSync) {
	return cloud.destination.path.split('/').filter(Boolean).at(-1) ?? cloud.destination.path
}

// The cloud folder a download mirrors, as presented to the user. Falls back to
// the given name (usually the provider display name) for provider roots.
export function cloudSyncRemoteName(cloud: CloudSync, fallback: string) {
	return cloud.remote.path.split('/').filter(Boolean).at(-1) ?? fallback
}

// The cloud whose destination is exactly this virtual path, if any. Used by
// the affordances that act on the destination folder itself (context menu
// verbs, the empty-folder download offer).
export function cloudSyncForPath(clouds: CloudSync[] | undefined, path: string) {
	return clouds?.find(({destination}) => destination.path === path)
}

// The cloud whose destination is this path or an ancestor of it, if any: the
// whole subtree is mirrored and read-only, so the banner explains that from
// anywhere inside, not just at the destination's root
export function cloudSyncContainingPath(clouds: CloudSync[] | undefined, path: string) {
	return clouds?.find(({destination}) => path === destination.path || path.startsWith(`${destination.path}/`))
}

// How an account is labeled in the sidebar and path bar: the provider name
// when it's the provider's only connected account, the account label otherwise
export function cloudAccountLabel(
	account: CloudAccount,
	accounts: CloudAccount[] | undefined,
	providers: CloudProvider[] | undefined,
) {
	const hasSiblings = (accounts ?? []).filter(({provider}) => provider === account.provider).length > 1
	if (hasSiblings) return account.displayName
	return providers?.find(({id}) => id === account.provider)?.displayName ?? account.displayName
}

export function useCloudSyncs(options?: {enabled?: boolean}) {
	return trpcReact.files.cloud.syncs.useQuery(undefined, {
		enabled: options?.enabled ?? true,
		placeholderData: keepPreviousData,
		staleTime: 5_000,
		// Poll for status transitions only while clouds exist. An empty store
		// stays quiet; mutations and the activity stream invalidate the query so
		// the first cloud still appears without polling.
		refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 5_000 : false),
	})
}

export function useCloudProviders(options?: {enabled?: boolean}) {
	return trpcReact.files.cloud.providers.useQuery(undefined, {
		enabled: options?.enabled ?? true,
		staleTime: 15_000,
	})
}

export function useCloudAccounts(options?: {enabled?: boolean}) {
	return trpcReact.files.cloud.accounts.useQuery(undefined, {
		enabled: options?.enabled ?? true,
		placeholderData: keepPreviousData,
		staleTime: 15_000,
		// Account-level attention (a revoked token on an account with no
		// clouds) has no other path into the UI, so poll modestly while any
		// consumer is mounted
		refetchInterval: 30_000,
	})
}

export function useCloudActions() {
	const utils = trpcReact.useUtils()

	const applyOptimisticUpdate = async (update: (clouds: CloudSync[]) => CloudSync[]) => {
		await utils.files.cloud.syncs.cancel()
		const previous = utils.files.cloud.syncs.getData()
		utils.files.cloud.syncs.setData(undefined, (clouds) => (clouds ? update(clouds) : clouds))
		return previous
	}

	const rollback = (previous: CloudSync[] | undefined) => {
		utils.files.cloud.syncs.setData(undefined, previous)
	}

	const pauseMutation = trpcReact.files.cloud.pause.useMutation({
		onMutate: ({syncId}) =>
			applyOptimisticUpdate((clouds) =>
				clouds.map((item) =>
					item.id === syncId
						? {
								...item,
								pauseReasons: {...item.pauseReasons, user: true as const},
								status: {...item.status, state: 'paused' as const},
							}
						: item,
				),
			),
		onError: (error, _variables, previous) => {
			rollback(previous)
			toast.error(t('files-cloud-error.pause', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
		onSettled: () => utils.files.cloud.syncs.invalidate(),
	})

	const resumeMutation = trpcReact.files.cloud.resume.useMutation({
		onMutate: ({syncId}) =>
			applyOptimisticUpdate((clouds) =>
				clouds.map((item) => {
					if (item.id !== syncId) return item
					const pauseReasons = item.pauseReasons?.restore
						? item.pauseReasons.user
							? {user: true as const}
							: undefined
						: undefined
					return {
						...item,
						pauseReasons,
						status: {...item.status, state: pauseReasons ? ('paused' as const) : ('queued' as const)},
					}
				}),
			),
		onError: (error, _variables, previous) => {
			rollback(previous)
			toast.error(t('files-cloud-error.resume', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
		onSettled: () => utils.files.cloud.syncs.invalidate(),
	})

	// No optimistic update: an already-running download stays running and the
	// backend simply returns the current state
	const runMutation = trpcReact.files.cloud.run.useMutation({
		onError: (error) => {
			toast.error(t('files-cloud-error.run', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
		onSettled: () => utils.files.cloud.syncs.invalidate(),
	})

	const removeSyncMutation = trpcReact.files.cloud.remove.useMutation({
		onMutate: ({syncId}) => {
			removedSyncIds.add(syncId)
			return applyOptimisticUpdate((clouds) => clouds.filter((item) => item.id !== syncId))
		},
		onError: (error, {syncId}, previous) => {
			removedSyncIds.delete(syncId)
			rollback(previous)
			toast.error(t('files-cloud-error.remove', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
		onSettled: () => utils.files.cloud.syncs.invalidate(),
	})

	const removeAccountMutation = trpcReact.files.cloud.removeAccount.useMutation({
		onMutate: ({confirmedSyncIds}) => {
			for (const syncId of confirmedSyncIds) removedSyncIds.add(syncId)
		},
		onError: (error, {confirmedSyncIds}) => {
			for (const syncId of confirmedSyncIds) removedSyncIds.delete(syncId)
			toast.error(t('files-cloud-error.remove-account', {message: getFilesErrorMessage(error.message)}), {
				area: 'files',
			})
		},
		onSettled: () => {
			utils.files.cloud.accounts.invalidate()
			utils.files.cloud.syncs.invalidate()
		},
	})

	const restoreMutation = trpcReact.files.cloud.restore.useMutation({
		onMutate: ({confirmedSyncIds}) => {
			for (const syncId of confirmedSyncIds) removedSyncIds.add(syncId)
		},
		onError: (_error, {confirmedSyncIds}) => {
			for (const syncId of confirmedSyncIds) removedSyncIds.delete(syncId)
		},
		onSettled: () => utils.files.cloud.syncs.invalidate(),
	})

	return {
		pauseSync: (syncId: string) => pauseMutation.mutateAsync({syncId}),
		resumeSync: (syncId: string) => resumeMutation.mutateAsync({syncId}),
		runNow: (syncId: string) => runMutation.mutateAsync({syncId}),
		removeSync: (syncId: string) => removeSyncMutation.mutateAsync({syncId}),
		removeAccount: (accountId: string, confirmedSyncIds: string[]) =>
			removeAccountMutation.mutateAsync({accountId, confirmedSyncIds}),
		restoreFiles: (confirmedSyncIds: string[], workItems: CloudRestoreWorkItem[]) =>
			restoreMutation.mutateAsync({confirmedSyncIds, workItems}),
		isPausing: pauseMutation.isPending,
		isResuming: resumeMutation.isPending,
		isRunningNow: runMutation.isPending,
		isRemovingSync: removeSyncMutation.isPending,
		isRemovingAccount: removeAccountMutation.isPending,
		isRestoringFiles: restoreMutation.isPending,
	}
}

// Connecting, browsing, and creating clouds. Browse and locations failures are
// returned to the caller instead of toasted: the wizard renders states like
// [cloud-account-busy] inline rather than as errors.
export function useCloudConnect() {
	const utils = trpcReact.useUtils()

	// Connect successes refresh clouds too: a reauthenticated account clears
	// its auth attention, which lives on each cloud's status
	const connectWebDavMutation = trpcReact.files.cloud.connectWebDav.useMutation({
		onSuccess: () => {
			utils.files.cloud.accounts.invalidate()
			utils.files.cloud.syncs.invalidate()
		},
		onError: (error: RouterError) => {
			// An untrusted certificate is a question, not a failure: the connect
			// form answers it with a confirmation dialog and retries insecurely
			if (error.message.includes('[cloud-webdav-untrusted-certificate]')) return
			toast.error(t('files-cloud-error.connect', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
	})

	const beginICloudMutation = trpcReact.files.cloud.beginICloud.useMutation({
		onSuccess: (result) => {
			// The rare no-2FA case completes the connect immediately
			if (result.complete) {
				utils.files.cloud.accounts.invalidate()
				utils.files.cloud.syncs.invalidate()
			}
		},
		onError: (error: RouterError) =>
			toast.error(t('files-cloud-error.connect', {message: getFilesErrorMessage(error.message)}), {area: 'files'}),
	})

	// Errors surface through the PinInput failure state, not a toast
	const continueICloudMutation = trpcReact.files.cloud.continueICloud.useMutation({
		onSuccess: (result) => {
			if (result.complete) {
				utils.files.cloud.accounts.invalidate()
				utils.files.cloud.syncs.invalidate()
			}
		},
	})

	// Create failures render inline in the wizard (e.g. a busy account), so no toast here
	const createMutation = trpcReact.files.cloud.create.useMutation({
		onSuccess: () => utils.files.cloud.syncs.invalidate(),
	})

	const fetchLocations = useCallback((accountId: string) => utils.files.cloud.locations.fetch({accountId}), [utils])

	const browseRemote = useCallback(
		(accountId: string, remote: CloudSyncRemote, maxEntries?: number) =>
			utils.files.cloud.browse.fetch({accountId, remote, ...(maxEntries === undefined ? {} : {maxEntries})}),
		[utils],
	)

	return {
		connectWebDav: connectWebDavMutation.mutateAsync,
		isConnectingWebDav: connectWebDavMutation.isPending,
		beginICloud: beginICloudMutation.mutateAsync,
		isBeginningICloud: beginICloudMutation.isPending,
		continueICloud: continueICloudMutation.mutateAsync,
		createSync: createMutation.mutateAsync,
		isCreatingSync: createMutation.isPending,
		fetchLocations,
		browseRemote,
	}
}

export type CloudOAuthFailure = 'failed' | 'expired'

// Runs a browser OAuth flow for connecting or re-authenticating a cloud provider. The
// provider returns to the stateless bouncer, where the user copies the authorization code;
// completion happens through an authenticated mutation using the device-held PKCE verifier.
// Failures carry the backend message so the failure screen can explain specific
// causes (wrong account on reauthentication, already-connected account) instead
// of one generic line.
export function useCloudOAuth({
	onComplete,
	onFailure,
}: {
	onComplete?: (result: {accountId: string; account: CloudAccount; locations: CloudLocations}) => void
	onFailure?: (failure: CloudOAuthFailure, message?: string) => void
} = {}) {
	const utils = trpcReact.useUtils()
	type OAuthClientSession = {
		accountId: string
		sessionId: string
		authorizationUrl: string
		popupBlocked: boolean
		expiresAtMonotonic: number
	}
	const [session, setSession] = useState<OAuthClientSession | null>(null)
	const sessionRef = useRef<OAuthClientSession | null>(null)
	const mountedRef = useRef(true)
	const onCompleteRef = useRef(onComplete)
	const onFailureRef = useRef(onFailure)
	onCompleteRef.current = onComplete
	onFailureRef.current = onFailure
	// Handle to the consent tab so completion/cancellation can close it if the bouncer did not.
	const consentTab = useRef<Window | null>(null)
	const closeConsentTab = useCallback(() => {
		consentTab.current?.close()
		consentTab.current = null
	}, [])

	const beginMutation = trpcReact.files.cloud.oauthBegin.useMutation({
		onError: (error: RouterError, variables) =>
			toast.error(
				variables.accountId
					? t('files-cloud-error.reauthenticate', {message: getFilesErrorMessage(error.message)})
					: t('files-cloud-error.connect', {message: getFilesErrorMessage(error.message)}),
				{area: 'files'},
			),
	})

	const completeMutation = trpcReact.files.cloud.oauthComplete.useMutation()
	const cancelMutation = trpcReact.files.cloud.oauthCancel.useMutation()
	const completionRef = useRef<Promise<void> | null>(null)
	const [isCompleting, setIsCompleting] = useState(false)
	const cancelMutationRef = useRef(cancelMutation.mutateAsync)
	cancelMutationRef.current = cancelMutation.mutateAsync
	const updateSession = useCallback((next: OAuthClientSession | null) => {
		sessionRef.current = next
		setSession(next)
	}, [])
	const cancelBackendSession = useCallback((pending: OAuthClientSession) => {
		void cancelMutationRef
			.current({
				accountId: pending.accountId,
				sessionId: pending.sessionId,
			})
			.catch(() => {})
	}, [])

	// Closing the dialog or navigating away must release an in-memory backend
	// session just like the explicit Cancel action.
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			const pending = sessionRef.current
			sessionRef.current = null
			if (pending) cancelBackendSession(pending)
			closeConsentTab()
		}
	}, [cancelBackendSession, closeConsentTab])

	// Keep the client-side expiry aligned with the in-memory backend session.
	useEffect(() => {
		if (!session) return
		const timeout = window.setTimeout(
			() => {
				if (sessionRef.current?.sessionId !== session.sessionId) return
				updateSession(null)
				closeConsentTab()
				cancelBackendSession(session)
				onFailureRef.current?.('expired')
			},
			Math.max(0, session.expiresAtMonotonic - performance.now()),
		)
		return () => window.clearTimeout(timeout)
	}, [cancelBackendSession, closeConsentTab, session, updateSession])

	// Opens the provider consent page in a new tab and keeps the local completion session.
	const begin = async (input: {provider: CloudOAuthProvider; reauthAccountId?: string}) => {
		// The tab must open synchronously within the click gesture — Safari (and Chrome once the
		// transient-activation window lapses) blocks window.open calls made after an await
		const tab = window.open('', '_blank')
		const popupBlocked = !tab
		try {
			const {accountId, sessionId, authorizationUrl, expiresInMs} = await beginMutation.mutateAsync({
				provider: input.provider,
				...(input.reauthAccountId ? {accountId: input.reauthAccountId} : {}),
			})
			// Keep browser wall-clock skew out of expiry. The backend remains
			// authoritative; this monotonic deadline only drives local UX cleanup.
			const pending = {
				accountId,
				sessionId,
				authorizationUrl,
				popupBlocked,
				expiresAtMonotonic: performance.now() + Math.max(0, expiresInMs),
			}
			if (!mountedRef.current) {
				tab?.close()
				cancelBackendSession(pending)
				return
			}
			if (tab) tab.location.href = authorizationUrl
			consentTab.current = tab
			updateSession(pending)
		} catch {
			// the mutation handles the error toast
			tab?.close()
		}
	}

	const complete = (code: string) => {
		if (completionRef.current) return completionRef.current
		const pending = sessionRef.current
		const normalizedCode = code.trim()
		if (!pending || !normalizedCode) return Promise.resolve()
		setIsCompleting(true)
		const operation = (async () => {
			try {
				const result = await completeMutation.mutateAsync({accountId: pending.accountId, code: normalizedCode})
				if (sessionRef.current?.sessionId !== pending.sessionId) return
				updateSession(null)
				closeConsentTab()
				utils.files.cloud.accounts.invalidate()
				utils.files.cloud.syncs.invalidate()
				onCompleteRef.current?.({accountId: result.account.id, account: result.account, locations: result.locations})
			} catch (error) {
				if (sessionRef.current?.sessionId !== pending.sessionId) return
				updateSession(null)
				closeConsentTab()
				const message = (error as RouterError).message
				if (message.includes('[cloud-auth-session-expired]')) onFailureRef.current?.('expired', message)
				else onFailureRef.current?.('failed', message)
			}
		})()
		completionRef.current = operation
		const clearCompletion = () => {
			if (completionRef.current !== operation) return
			completionRef.current = null
			setIsCompleting(false)
		}
		operation.then(clearCompletion, clearCompletion)
		return operation
	}

	const cancel = () => {
		const pending = sessionRef.current
		updateSession(null)
		closeConsentTab()
		if (pending) cancelBackendSession(pending)
	}

	return {
		begin,
		complete,
		cancel,
		isStarting: beginMutation.isPending,
		isCompleting,
		isWaiting: !!session,
		authorizationUrl: session?.authorizationUrl,
		isPopupBlocked: session?.popupBlocked ?? false,
	}
}
