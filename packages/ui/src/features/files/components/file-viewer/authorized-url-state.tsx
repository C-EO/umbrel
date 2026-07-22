import type {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertCircle, TbLoader} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import type {AuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

export function AuthorizedUrlState({
	query,
	children,
}: {
	query: AuthorizedHttpUrlQuery
	children: (url: string) => ReactNode
}) {
	const {t} = useTranslation()

	if (query.status === 'ready') return children(query.url)
	if (query.status === 'idle') return null

	return (
		<ViewerWrapper>
			{query.status === 'loading' ? (
				<TbLoader className='size-6 animate-spin text-white/40' />
			) : (
				<div className='flex w-[380px] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 text-center shadow-dialog backdrop-blur-2xl contrast-more:bg-dialog-content contrast-more:backdrop-blur-none'>
					<div className='flex size-14 items-center justify-center rounded-full bg-white/6'>
						<TbAlertCircle className='size-6 text-white/40' />
					</div>
					<div>
						<h3 className='text-15 font-semibold -tracking-2 text-white/90'>
							{t('files-viewer.auth-error-title', 'Unable to open this file')}
						</h3>
						<p className='mt-1.5 text-13 text-white/40'>
							{t('files-viewer.auth-error-description', 'Umbrel could not authorize this file request.')}
						</p>
					</div>
					<Button onClick={query.retry} disabled={query.isRetrying}>
						{query.isRetrying ? t('loading') : t('try-again')}
					</Button>
				</div>
			)}
		</ViewerWrapper>
	)
}
