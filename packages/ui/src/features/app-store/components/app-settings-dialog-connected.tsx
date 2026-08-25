import {registryAppPath} from '@/constants/app-store'
import {useStoreActions} from '@/features/app-store/providers/store-actions'
import {AppSettingsDialog} from '@/modules/app-store/app-page/app-settings-dialog'

export function AppSettingsDialogConnected() {
	const actions = useStoreActions()

	return <AppSettingsDialog onInstallDependency={actions?.installApp} makeDependencyPath={registryAppPath} />
}
