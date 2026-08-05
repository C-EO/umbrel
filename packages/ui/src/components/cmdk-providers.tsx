import {lazy, Suspense, type ComponentType} from 'react'

import {FilesCmdkSearchProvider} from '@/features/files/cmdk-search-provider'

export interface CmdkSearchProviderProps {
	query: string
	close: () => void
}

export type CmdkSearchProvider = ComponentType<CmdkSearchProviderProps>

const SettingsCmdkSearchProvider = lazy(() =>
	import('@/routes/settings/cmdk-search-provider').then((module) => ({default: module.SettingsCmdkSearchProvider})),
)

function LazySettingsCmdkSearchProvider(props: CmdkSearchProviderProps) {
	return (
		<Suspense fallback={null}>
			<SettingsCmdkSearchProvider {...props} />
		</Suspense>
	)
}

export const cmdkSearchProviders: CmdkSearchProvider[] = [LazySettingsCmdkSearchProvider, FilesCmdkSearchProvider]
