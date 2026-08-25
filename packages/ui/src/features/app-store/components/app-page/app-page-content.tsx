import {storeRevealClass, storeRevealDelay} from '@/features/app-store/constants'
import {hasTimelineContent, type ReleaseTimelineEntry} from '@/features/app-store/data/releases'
import {cn} from '@/lib/utils'
import {RegistryApp, UserApp} from '@/trpc/trpc'

import {AppGallery} from './app-gallery'
import {AboutSection, CredentialsSection, DependenciesSection, InfoBand} from './app-sections'
import {ReleaseTimeline} from './release-timeline'

/**
 * The body of an app page: gallery, the info band, then the description with
 * the release timeline (and installed-app extras) alongside it. One responsive
 * tree — on small screens the columns simply stack.
 */
export function AppPageContent({
	app,
	userApp,
	releaseTimeline = [],
	highlightLatestRelease = false,
	showDependencies,
	registryId = app.appStoreId,
	makeAppPath,
}: {
	app: RegistryApp
	/** When the user initiates an install, we have a user app even before install */
	userApp?: UserApp
	releaseTimeline?: ReleaseTimelineEntry[]
	highlightLatestRelease?: boolean
	showDependencies?: (dependencyId?: string) => void
	registryId?: string
	makeAppPath?: (app: RegistryApp) => string
}) {
	const hasDependencies = (app.dependencies?.length ?? 0) > 0
	const showTimeline = hasTimelineContent(releaseTimeline)
	const hasSideColumn = showTimeline || !!userApp || hasDependencies

	return (
		<>
			{/* The page composes itself top to bottom: gallery, then the info
			    band, then the two columns — each a beat behind the last */}
			{app.gallery.length > 0 && (
				<div className={storeRevealClass} style={storeRevealDelay(120)}>
					<AppGallery galleryId={'gallery-' + app.id} gallery={app.gallery} />
				</div>
			)}
			<div className={storeRevealClass} style={storeRevealDelay(200)}>
				<InfoBand app={app} />
			</div>
			<div
				className={cn(
					'flex flex-col gap-8 px-2.5 md:px-0',
					hasSideColumn && 'lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)] lg:items-start lg:gap-11',
				)}
			>
				<div className={storeRevealClass} style={storeRevealDelay(260)}>
					<AboutSection app={app} />
				</div>
				{hasSideColumn && (
					<div className={cn('flex flex-col gap-7', storeRevealClass)} style={storeRevealDelay(320)}>
						{userApp && <CredentialsSection userApp={userApp} />}
						{hasDependencies && (
							<DependenciesSection
								app={app}
								registryId={registryId}
								showDependencies={showDependencies}
								makeAppPath={makeAppPath}
							/>
						)}
						{showTimeline && <ReleaseTimeline entries={releaseTimeline} highlightLatest={highlightLatestRelease} />}
					</div>
				)}
			</div>
		</>
	)
}
