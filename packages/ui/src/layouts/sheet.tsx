import {Suspense, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet, useLocation, useNavigate} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {Sheet, SheetContent, SheetTitle} from '@/components/ui/sheet'
import {ScrollArea} from '@/components/ui/sheet-scroll-area'
import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'
import {SheetFixedTarget} from '@/modules/sheet-top-fixed'
import {SheetStickyHeaderProvider, SheetStickyHeaderTarget, useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {useAfterDelayedClose} from '@/utils/dialog'

import {getSheetScrollRestorationAction} from './sheet-scroll-restoration'

export function SheetLayout() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	const [open, setOpen] = useState(true)

	const scrollRef = useRef<HTMLDivElement>(null)

	useScrollRestoration(scrollRef, getSheetScrollRestorationAction)

	const isSettingsRoute = /^\/settings(\/|$)/.test(location.pathname)
	// Desktop Files manages its own viewport-relative heights (sidebar reaches
	// below the dock line), so the dock spacer would only add phantom scroll
	const isFilesRoute = /^\/files(\/|$)/.test(location.pathname)

	// The Sheet layout persists between Files, App Store, and Settings. Clear a
	// stale outer offset before paint when entering Settings. Desktop Settings
	// then delegates scrolling to its two contained panes.
	useLayoutEffect(() => {
		if (isSettingsRoute) scrollRef.current?.scrollTo(0, 0)
	}, [isSettingsRoute])

	useAfterDelayedClose(open, () => {
		navigate('/')
	})

	return (
		<>
			<Sheet open={open} onOpenChange={setOpen} modal={false}>
				<SheetStickyHeaderProvider scrollRef={scrollRef}>
					{/* NOTE: If you change these width/max-width values, also update the
					   text editor width in features/files/components/file-viewer/text-viewer/index.tsx
					   which derives its sizing from these same breakpoints. */}
					<SheetContent
						side='bottom-zoom'
						className='mx-auto h-[calc(100dvh-var(--sheet-top))] max-w-[1320px] md:w-[calc(100vw-25px-25px)] lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]'
						backdrop={
							open && (
								<div
									data-state={open ? 'open' : 'closed'}
									className='fixed inset-0 z-30'
									onClick={() => setOpen(false)}
								/>
							)
						}
						closeButton={<SheetCloseButton />}
						onOpenAutoFocus={(e) => e.preventDefault()}
						onInteractOutside={(e) => e.preventDefault()}
						onEscapeKeyDown={(e) => e.preventDefault()}
					>
						<SheetFixedTarget />
						<SheetStickyHeaderTarget />
						<ScrollArea
							className='umbrel-window-surface-top h-full'
							fade={!isFilesRoute}
							viewportRef={scrollRef}
							viewportClassName={cn(isSettingsRoute && 'lg:!overflow-hidden lg:[&>div]:!h-full')}
							scrollbarClassName={cn(isSettingsRoute && 'lg:hidden')}
						>
							<div
								className={cn(
									'flex flex-col gap-5 px-3 pt-6 md:px-[40px] md:pt-12',
									isSettingsRoute
										? 'lg:h-full lg:min-h-0 lg:gap-0 lg:pt-0 xl:px-[60px]'
										: isFilesRoute
											? 'xl:px-[60px]'
											: 'xl:px-[70px]',
								)}
							>
								<Suspense fallback={<SheetTitle className='sr-only'>{t('loading')}</SheetTitle>}>
									<Outlet />
								</Suspense>
								<DockSpacer className={cn('mt-4', (isSettingsRoute || isFilesRoute) && 'lg:hidden')} />
							</div>
						</ScrollArea>
					</SheetContent>
				</SheetStickyHeaderProvider>
			</Sheet>
		</>
	)
}

function SheetCloseButton() {
	const {showStickyHeader, hideCloseButton} = useSheetStickyHeader()

	// A sticky header portals in its own close button, and a page can suppress this
	// one outright when it renders its own (mobile settings' sticky controls rail).
	if (showStickyHeader || hideCloseButton) return null

	return <DialogCloseButton className='absolute top-3 right-3 z-[60] sm:top-5 sm:right-5' />
}
