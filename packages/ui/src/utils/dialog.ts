// TODO: move to misc.ts
import {useEffect, useState} from 'react'
import {type To} from 'react-router-dom'

import {useQueryParams} from '@/hooks/use-query-params'
import {SettingsDialogKey} from '@/routes/settings'
import {sleep} from '@/utils/misc'

export const EXIT_DURATION_MS = 100

export type GlobalDialogKey = 'logout' | 'live-usage' | 'whats-new' | 'add-shortcut' | 'app-share-users'
export type AppStoreDialogKey =
	| 'updates'
	| 'add-community-store'
	| 'default-credentials'
	| 'app-settings'
	| 'app-requires-https'
export type FilesDialogKey =
	| 'files-share-info'
	| 'files-share-users'
	| 'files-empty-trash-confirmation'
	| 'files-extension-change-confirmation'
	| 'files-permanently-delete-confirmation'
	| 'files-add-network-share'
	| 'files-format-drive'
	| 'files-cloud-add'
export type PhotosDialogKey =
	| 'photos-source'
	| 'photos-add-source'
	| 'photos-item'
	| 'photos-create-album'
	| 'photos-rename-album'
export type DialogKey = GlobalDialogKey | AppStoreDialogKey | SettingsDialogKey | FilesDialogKey | PhotosDialogKey

// Some dialog params read better unprefixed in the URL (?app=jellyfin instead
// of ?app-settings-for=jellyfin). Maps a dialog's linkToDialog param names to
// the raw query keys used in the URL; unlisted params keep the
// `<dialogKey>-` prefix. Raw keys must not collide with other query params.
const dialogParamAliases: Partial<Record<DialogKey, Record<string, string>>> = {
	'app-settings': {for: 'app', view: 'view', dependency: 'dependency'},
}

export function getDialogParamKey(dialogKey: DialogKey, param: string) {
	return dialogParamAliases[dialogKey]?.[param] ?? `${dialogKey}-${param}`
}

// TODO: make dialog query params typesafe

/**
 * For use with dialogs and other Radix elements with an `onOpenChange` prop.
 */
export function afterDelayedClose(cb?: () => void) {
	return (open: boolean) => !open && sleep(EXIT_DURATION_MS).then(cb)
}

export function useAfterDelayedClose(open: boolean, cb: () => void, delayMs: number = EXIT_DURATION_MS) {
	useEffect(() => {
		const id = setTimeout(() => {
			if (!open) cb()
		}, delayMs)

		// Cancel the timeout if the component unmounts or the `open` prop changes.
		return () => clearTimeout(id)
	}, [open, cb, delayMs])
}

/** Allow controlling dialog from query params */
export function useDialogOpenProps(dialogKey: DialogKey) {
	const {params, add, filter} = useQueryParams()
	const [open, setOpen] = useState(false)

	// Update open state when url is changed from the outside
	useEffect(() => {
		setOpen(params.get('dialog') === dialogKey)
	}, [params, dialogKey])

	const addQueryParam = () => {
		add('dialog', dialogKey)
	}

	const removeQueryParam = async () => {
		await sleep(EXIT_DURATION_MS)
		// Remove `dialog`, all `dialogKey` prefixed search params, and any
		// unprefixed aliases this dialog uses
		const aliasKeys = new Set(Object.values(dialogParamAliases[dialogKey] ?? {}))
		filter(([key]) => {
			const isDialog = key === 'dialog'
			const dialogParams = key.startsWith(dialogKey) || aliasKeys.has(key)
			return !(isDialog || dialogParams)
		})
	}

	const onOpenChange = (open: boolean) => {
		// Keeping this here despite `useEffect` to change open state immediately
		setOpen(open)
		if (open) {
			addQueryParam()
		} else {
			removeQueryParam()
		}
	}

	return {open, onOpenChange}
}

/** For react router  */
export function useLinkToDialog() {
	const {addLinkSearchParams} = useQueryParams()
	return (
		dialogKey: DialogKey,
		otherParams?: {
			[key: string]: string
		},
	): To => {
		const otherParamsModified: {[key: string]: string} = {}
		if (otherParams) {
			Object.keys(otherParams).forEach((key) => {
				otherParamsModified[getDialogParamKey(dialogKey, key)] = otherParams[key]
			})
		}
		return {
			search: addLinkSearchParams({dialog: dialogKey, ...otherParamsModified}),
		}
	}
}
