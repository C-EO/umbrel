import {useTranslation} from 'react-i18next'

import {CopyableField} from '@/components/ui/copyable-field'
import {Switch} from '@/components/ui/switch'
import {trpcReact, UserApp} from '@/trpc/trpc'

import {BackButton, SettingsViewHeader} from './shared'

export function appHasDefaultCredentials(app: UserApp) {
	return Boolean(app.credentials?.defaultUsername || app.credentials?.defaultPassword)
}

export function CredentialsSettingsView({app, onBack}: {app: UserApp; onBack: () => void}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	// The toggle applies instantly, like the same control on the pre-open
	// credentials dialog it mirrors
	const hideCredentialsMut = trpcReact.apps.hideCredentialsBeforeOpen.useMutation({
		onSuccess: () => utils.apps.invalidate(),
	})
	const showBeforeOpen = hideCredentialsMut.isPending
		? !hideCredentialsMut.variables?.value
		: (app.credentials?.showBeforeOpen ?? false)

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('app-settings.title')}</BackButton>

			<SettingsViewHeader
				title={t('app-settings.credentials.title')}
				description={t('app-settings.credentials.page-description', {app: app.name})}
			/>

			<div className='flex flex-col gap-3 rounded-12 bg-white/6 p-4'>
				{app.credentials?.defaultUsername ? (
					<div>
						<div className='pb-1 text-13 text-white/40'>{t('default-credentials.username')}</div>
						<CopyableField value={app.credentials.defaultUsername} />
					</div>
				) : null}
				{app.credentials?.defaultPassword ? (
					<div>
						<div className='pb-1 text-13 text-white/40'>{t('default-credentials.password')}</div>
						<CopyableField isPassword value={app.credentials.defaultPassword} />
					</div>
				) : null}
			</div>

			<div className='rounded-12 bg-white/6 p-4'>
				<div className='flex items-center justify-between gap-4'>
					<div className='space-y-1'>
						<div className='text-14 leading-tight font-medium'>{t('app-settings.credentials.show-before-opening')}</div>
						<div className='text-12 leading-tight text-white/40'>
							{t('app-settings.credentials.show-before-opening-description')}
						</div>
					</div>
					<Switch
						checked={showBeforeOpen}
						disabled={hideCredentialsMut.isPending}
						onCheckedChange={(checked) => hideCredentialsMut.mutate({appId: app.id, value: !checked})}
					/>
				</div>
			</div>
		</div>
	)
}
