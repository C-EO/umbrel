import {useTranslation} from 'react-i18next'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useNavigate} from '@/features/files/hooks/use-navigate'

// The owner's Umbrel as a single folder entry in a member's sidebar. It roots
// at /Home, members can navigate down from there but only see the whitelisted
// paths leading to what's been shared with them.
export function SidebarOwnersUmbrel({name}: {name: string}) {
	const {navigateToDirectory, currentPath} = useNavigate()

	return (
		<SidebarItem
			item={{name, path: '/Home', type: 'directory'}}
			isActive={currentPath === '/Home' || currentPath.startsWith('/Home/')}
			onClick={() => navigateToDirectory('/Home')}
		/>
	)
}

// Category-wide storage grants. The root entries automatically include devices
// and network shares connected after the permission was granted.
export function SidebarSharedStorage({external, network}: {external: boolean; network: boolean}) {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useNavigate()

	const categories = [
		external && {path: '/External', name: t('files-sidebar.external-storage'), type: 'external-storage' as const},
		network && {path: '/Network', name: t('files-sidebar.network'), type: 'network-root' as const},
	].filter((category) => category !== false)

	return (
		<>
			{categories.map((category) => (
				<SidebarItem
					key={category.path}
					item={category}
					isActive={currentPath === category.path || currentPath.startsWith(`${category.path}/`)}
					onClick={() => navigateToDirectory(category.path)}
				/>
			))}
		</>
	)
}
