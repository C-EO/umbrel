import {useTranslation} from 'react-i18next'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {MACHINES_PATH} from '@/features/files/constants'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'

export function SidebarMachines() {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useFilesNavigate()

	return (
		<SidebarItem
			item={{name: t('files-sidebar.machines'), path: MACHINES_PATH, type: 'directory'}}
			isActive={currentPath === MACHINES_PATH}
			onClick={() => navigateToDirectory(MACHINES_PATH)}
		/>
	)
}
