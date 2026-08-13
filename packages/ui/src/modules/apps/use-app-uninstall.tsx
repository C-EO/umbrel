import {ReactNode, useState} from 'react'

import type {useAppInstall} from '@/hooks/use-app-install'

import {UninstallConfirmationDialog} from './uninstall-confirmation-dialog'
import {UninstallTheseFirstDialog} from './uninstall-these-first-dialog'

/**
 * The full uninstall flow for an app: dependents precheck, the "uninstall
 * these first" dialog, and the destructive confirmation dialog. Call
 * `promptUninstall` from a menu item or button and render `dialogs` somewhere
 * that outlives it. Takes the caller's existing `useAppInstall` instance so an
 * app never mounts duplicate state controllers.
 */
export function useAppUninstall(
	appId: string,
	appInstall: Pick<ReturnType<typeof useAppInstall>, 'uninstall' | 'getAppsToUninstallFirst'>,
): {promptUninstall: () => Promise<void>; dialogs: ReactNode} {
	const [showConfirmation, setShowConfirmation] = useState(false)
	const [depsOpen, setDepsOpen] = useState(false)
	const [toUninstallFirstIds, setToUninstallFirstIds] = useState<string[]>([])

	const promptUninstall = async () => {
		const apps = await appInstall.getAppsToUninstallFirst()
		if (apps.length > 0) {
			setToUninstallFirstIds(apps)
			setDepsOpen(true)
		} else {
			setShowConfirmation(true)
		}
	}

	// `useAppInstall.uninstall` re-checks dependents right before uninstalling,
	// so the answer has to be handled here too
	const uninstall = async () => {
		const res = await appInstall.uninstall()
		if (res?.uninstallTheseFirst) {
			setToUninstallFirstIds(res.uninstallTheseFirst)
			setDepsOpen(true)
		} else {
			setShowConfirmation(false)
		}
	}

	const dialogs = (
		<>
			{toUninstallFirstIds.length > 0 && (
				<UninstallTheseFirstDialog
					appId={appId}
					toUninstallFirstIds={toUninstallFirstIds}
					open={depsOpen}
					onOpenChange={setDepsOpen}
				/>
			)}
			{showConfirmation && (
				<UninstallConfirmationDialog
					appId={appId}
					open={showConfirmation}
					onOpenChange={setShowConfirmation}
					onConfirm={uninstall}
				/>
			)}
		</>
	)

	return {promptUninstall, dialogs}
}
