import React from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Checkbox, checkboxContainerClass, checkboxLabelClass} from '@/components/ui/checkbox'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {useUserApp} from '@/providers/apps'
import {useDialogOpenProps} from '@/utils/dialog'
import {getAlwaysOpenHttpsRequiredApps, setAlwaysOpenHttpsRequiredApps} from '@/utils/misc'

export function AppRequiresHttpsDialog() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const params = useQueryParams()
	const dialogProps = useDialogOpenProps('app-requires-https')
	const appId = params.params.get('app-requires-https-for')
	const path = params.params.get('app-requires-https-path') ?? undefined
	const {app, isLoading} = useUserApp(appId)
	const launchApp = useLaunchApp()
	const checkboxId = React.useId()
	const [alwaysOpen, setAlwaysOpen] = React.useState(getAlwaysOpenHttpsRequiredApps)

	// This dialog stays mounted after closing, so re-sync the checkbox from storage on
	// every open. Otherwise a tick abandoned via dismissal would resurface (and could be
	// persisted) the next time any app opens this dialog.
	const {open} = dialogProps
	React.useEffect(() => {
		if (open) setAlwaysOpen(getAlwaysOpenHttpsRequiredApps())
	}, [open])

	if (isLoading || !appId || !app) return null

	const openOverHttps = () => {
		// Persist the checkbox only when the user actually opens the app, so dismissing
		// the dialog with the box ticked does not permanently silence it.
		setAlwaysOpenHttpsRequiredApps(alwaysOpen)
		// Launching through the hook keeps app opens tracked and preserves any deep link path.
		launchApp(appId, {direct: true, protocol: 'https:', path})
		dialogProps.onOpenChange(false)
	}

	const openInstructions = () => {
		navigate('/settings/advanced/network?httpsAccess=guide')
	}

	const handleAlwaysOpenChange = (checked: boolean | 'indeterminate') => {
		setAlwaysOpen(checked === true)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('app-requires-https-dialog-title', {app: app.name})}</DialogTitle>
					<DialogDescription>{t('app-requires-https-dialog-description', {app: app.name})}</DialogDescription>
					<button
						type='button'
						onClick={openInstructions}
						className='w-fit text-left text-12 font-medium text-white/50 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/70 hover:decoration-white/40'
					>
						{t('app-requires-https-dialog-learn')}
					</button>
				</DialogHeader>
				<div className='flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between'>
					<div className='flex flex-col'>
						<label htmlFor={checkboxId} className={checkboxContainerClass}>
							<Checkbox id={checkboxId} checked={alwaysOpen} onCheckedChange={handleAlwaysOpenChange} />
							<span className={cn(checkboxLabelClass, 'text-13')}>{t('app-requires-https-dialog-always-open')}</span>
						</label>
					</div>
					<Button variant='primary' size='dialog' className='w-full md:w-auto' onClick={openOverHttps}>
						{t('app-requires-https-dialog-action')}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
