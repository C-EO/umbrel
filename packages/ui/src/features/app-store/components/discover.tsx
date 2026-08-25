import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {Navigate} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {AppGrid} from '@/features/app-store/components/app-grid'
import {SectionHeading} from '@/features/app-store/components/section-heading'
import {SortControl, useSortParam} from '@/features/app-store/components/sort-control'
import {StorefrontSectionView} from '@/features/app-store/components/storefront-sections'
import {categoryPath, storeRevealClass, storeRevealDelay} from '@/features/app-store/constants'
import {getAvailableSorts, sortApps} from '@/features/app-store/data/catalog'
import {useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {useStorefront} from '@/features/app-store/hooks/use-storefront'
import {useAvailableApps} from '@/providers/available-apps'

// The storefront home: remote editorial sections over the complete local
// catalog. The page waits for the feed's first attempt (see use-storefront.ts)
// so it composes once; there is no spinner and no error state for editorial
// failure — offline the complete catalog is the landing page instead.
export default function Discover() {
	return (
		<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
			<DiscoverContent />
		</ErrorBoundary>
	)
}

function DiscoverContent() {
	const {t} = useTranslation()
	const availableApps = useAvailableApps()
	const storefront = useStorefront()
	const statuses = useAppStatusMap()
	const availableSorts = getAvailableSorts(storefront.dates)
	const sort = useSortParam(availableSorts)

	if (availableApps.isLoading || storefront.isLoading) return null

	// Discover is the editorial home; when the feed is definitively unavailable
	// the complete catalog is the better landing page (the rail's Discover pill
	// is disabled in that state too)
	if (storefront.isUnavailable) return <Navigate to={categoryPath('all')} replace />

	const allApps = sortApps(availableApps.apps ?? [], sort, storefront.dates)

	// Sections compose in top to bottom, each a beat behind the one before
	const sectionDelay = (index: number) => storeRevealDelay(Math.min(90 + index * 70, 440))

	return (
		<>
			{storefront.sections.map((section, index) => (
				<div key={section.id} className={storeRevealClass} style={sectionDelay(index)}>
					<StorefrontSectionView section={section} statuses={statuses} />
				</div>
			))}
			{/* The complete catalog sits directly on the sheet, not in a card */}
			<section className='flex flex-col gap-4'>
				<div className={storeRevealClass} style={storeRevealDelay(90)}>
					<SectionHeading
						title={t('app-store.section.all-apps')}
						rightChildren={<SortControl availableSorts={availableSorts} />}
					/>
				</div>
				<AppGrid apps={allApps} statuses={statuses} revealDelayStart={130} />
			</section>
		</>
	)
}
