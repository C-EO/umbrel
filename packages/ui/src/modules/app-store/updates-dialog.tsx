import {DialogProps} from '@radix-ui/react-dialog'
import {Fragment, useState} from 'react'

import {AppIcon} from '@/components/app-icon'
import {Markdown} from '@/components/markdown'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useUpdateAllApps} from '@/hooks/use-update-all-apps'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp, trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function UpdatesDialogConnected() {
	const dialogProps = useDialogOpenProps('updates')
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()
	const updateAll = useUpdateAllApps()

	if (isLoading) return null

	return (
		<UpdatesDialog
			{...dialogProps}
			open={dialogProps.open}
			appsWithUpdates={appsWithUpdates}
			titleRightChildren={
				<Button
					size='dialog'
					variant='primary'
					onClick={updateAll.updateAll}
					className='w-auto'
					disabled={updateAll.isLoading || appsWithUpdates.length === 0}
				>
					{/* TODO: translate */}
					{updateAll.isLoading ? t('app-updates.updating') : t('app-updates.update-all')}
				</Button>
			}
		/>
	)
}

export function UpdatesDialog({
	appsWithUpdates,
	titleRightChildren,
	...dialogProps
}: {
	appsWithUpdates: RegistryApp[]
	titleRightChildren?: React.ReactNode
} & DialogProps) {
	const title = t('app-updates.title')

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent
					className='top-[10%] max-h-[calc(100vh-20%)] translate-y-0 gap-0 p-0 py-5 data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:slide-in-from-top-[0%]'
					slide={false}
				>
					<DialogHeader className='px-5 pb-5'>
						<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
						<DialogTitle className='flex flex-row items-center justify-between'>
							<span>{t('app-updates.updates-available-count', {count: appsWithUpdates.length})}</span>
							{titleRightChildren}
						</DialogTitle>
					</DialogHeader>
					<Separator />
					<ScrollArea className='flex max-h-[500px] flex-col gap-y-2.5 px-5'>
						{appsWithUpdates.map((app, i) => (
							<Fragment key={app.id}>
								{i === 0 ? undefined : <Separator className='my-1' />}
								<AppItem app={app} />
							</Fragment>
						))}
					</ScrollArea>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
function AppItem({app}: {app: RegistryApp}) {
	const [showAll, setShowAll] = useState(false)
	const ctx = trpcReact.useContext()
	const updateMut = trpcReact.apps.update.useMutation({
		onSuccess: () => {
			// This should cause the app to be removed from the list
			ctx.apps.list.invalidate()
		},
	})
	const updateApp = () => updateMut.mutate({appId: app.id})

	return (
		<div className='p-2.5'>
			<div className='flex items-center gap-2.5'>
				<AppIcon src={app.icon} size={36} className='rounded-8' />
				<div className='flex flex-col'>
					<h3 className='text-13 font-semibold'>{app.name}</h3>
					<p className='text-13 opacity-40'>{app.version}</p>
				</div>
				<div className='flex-1' />
				<Button size='sm' onClick={updateApp} disabled={updateMut.isLoading}>
					{updateMut.isLoading ? t('app-updates.updating') : t('app-updates.update')}
				</Button>
			</div>
			{app.releaseNotes && (
				<div className='relative mt-2 grid'>
					<div
						className={cn('relative overflow-x-auto text-13 opacity-50 transition-all')}
						style={{
							maskImage: showAll ? undefined : 'linear-gradient(-45deg, transparent 30px, white 60px, white)',
						}}
					>
						<Markdown className={cn('text-13 leading-snug -tracking-3', !showAll && 'line-clamp-2')}>
							{app.releaseNotes}
						</Markdown>
					</div>
					<button
						className={cn(
							'justify-self-end text-13 text-brand underline underline-offset-2',
							!showAll && 'absolute bottom-0 right-0 ',
						)}
						onClick={() => setShowAll((s) => !s)}
					>
						{showAll ? t('app-updates.less') : t('app-updates.more')}
					</button>
				</div>
			)}
		</div>
	)
}