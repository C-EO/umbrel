import {useTranslation} from 'react-i18next'
import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'
import {groupBy} from 'remeda'
import {objectKeys} from 'ts-extras'

import {Loading} from '@/components/ui/loading'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {communityAppPath} from '@/constants/app-store'
import {AppGridSection} from '@/features/app-store/components/app-grid'
import {storeRevealClass, storeRevealDelay, storeRevealSoftClass} from '@/features/app-store/constants'
import {getCategoryLabel} from '@/features/app-store/data/catalog'
import {useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {StoreActionsProvider} from '@/features/app-store/providers/store-actions'
import {cn} from '@/lib/utils'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {trpcReact} from '@/trpc/trpc'

export default function CommunityAppStoreHome() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {appStoreId} = useParams<{appStoreId: string}>()
	const registryId = appStoreId ?? ''

	const registryQ = trpcReact.appStore.registry.useQuery()
	const statuses = useAppStatusMap(registryId)

	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)
	const appStoreName = appStore?.meta.name

	if (registryQ.isLoading) {
		return <Loading />
	}

	if (registryQ.isError || !registryQ.data || !appStore) {
		throw new Error('No data')
	}

	const apps = appStore.apps
	const appsGroupedByCategory = groupBy(apps, (app) => app.category)

	return (
		<StoreActionsProvider>
			<div className='flex flex-col gap-5 md:gap-6'>
				<SheetHeader className={cn('gap-4', storeRevealSoftClass)}>
					<div className='flex flex-col gap-3 px-2.5 md:px-0'>
						<CommunityBadge className='self-start' />
						<button
							onClick={() => navigate('/app-store')}
							className='flex items-center gap-1 self-start underline-offset-2 outline-hidden focus-visible:underline'
						>
							<TbArrowLeft className='h-5 w-5' />
							{t('community-app-store.back-to-umbrel-app-store')}
						</button>
						<SheetTitle className='leading-none'>{`${appStoreName} app store`}</SheetTitle>
					</div>
				</SheetHeader>
				{objectKeys(appsGroupedByCategory).map((category, index) => (
					<div key={category} className={storeRevealClass} style={storeRevealDelay(Math.min(70 + index * 70, 420))}>
						<AppGridSection
							title={getCategoryLabel(category)}
							apps={appsGroupedByCategory[category]}
							statuses={statuses}
							makeTo={(app) => communityAppPath(registryId, app.id)}
						/>
					</div>
				))}
			</div>
		</StoreActionsProvider>
	)
}
