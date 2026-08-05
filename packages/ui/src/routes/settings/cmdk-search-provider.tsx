import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {resolvePath, useLocation, useNavigate, type Location} from 'react-router-dom'

import {type CmdkSearchProviderProps} from '@/components/cmdk-providers'
import {CommandItem} from '@/components/ui/command'
import {useBackups} from '@/features/backups/hooks/use-backups'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {systemAppsKeyed} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

import {
	createSettingsCatalog,
	getDefaultSettingsCommandItems,
	getSettingsCommandItems,
	getSettingsCommandTarget,
	settingsItemSearchAliases,
	settingsItemSearchText,
} from './_components/settings-catalog'

export function SettingsCmdkSearchProvider({query, close}: CmdkSearchProviderProps) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()
	const {deviceName} = useIsHomeOrPro()
	const userQ = trpcReact.user.get.useQuery()
	const trimmedQuery = query.trim()
	const isMember = userQ.data?.role === 'member'
	const {repositories} = useBackups({repositoriesEnabled: Boolean(userQ.data) && !isMember})
	const catalog = useMemo(() => createSettingsCatalog(t, {deviceName, isMember}), [t, deviceName, isMember])
	const items = userQ.isLoading
		? []
		: trimmedQuery
			? getSettingsCommandItems(catalog, trimmedQuery)
			: getDefaultSettingsCommandItems(catalog)

	return items.map((item) => {
		const searchText = settingsItemSearchText(item)
		return (
			<CommandItem
				key={item.id}
				icon={systemAppsKeyed['UMBREL_settings'].icon}
				value={searchText}
				keywords={settingsItemSearchAliases(item)}
				onSelect={() => {
					const target = getSettingsCommandTarget(item)
					if (target.type === 'external') window.open(target.to, '_blank', 'noopener,noreferrer')
					else if (target.type === 'backups') {
						navigate((repositories?.length ?? 0) > 0 ? '/settings/backups/configure' : '/settings/backups/setup')
					} else if (target.type === 'current-location-dialog') {
						navigate(addDialogToLocation(location, target.dialog))
					} else {
						navigate(target.to, {replace: shouldReplaceSettingsNavigation(location.pathname, target.to)})
					}
					close()
				}}
			>
				<span>
					{item.title}{' '}
					<span className='opacity-50'>
						{t('generic-in')} {t('settings')}
					</span>
				</span>
			</CommandItem>
		)
	})
}

export function addDialogToLocation(location: Pick<Location, 'pathname' | 'search' | 'hash'>, dialog: 'logout') {
	const search = new URLSearchParams(location.search)
	search.set('dialog', dialog)
	return {pathname: location.pathname, search: search.toString(), hash: location.hash}
}

export function shouldReplaceSettingsNavigation(currentPathname: string, to: string) {
	return resolvePath(to, currentPathname).pathname === currentPathname
}
