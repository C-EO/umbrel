import {useTranslation} from 'react-i18next'
import {TbAlertTriangle} from 'react-icons/tb'

type PoolDataErrorBannerProps = {
	errorCount?: number
}

export function PoolDataErrorBanner({errorCount = 0}: PoolDataErrorBannerProps) {
	const {t} = useTranslation()
	if (errorCount <= 0) return null

	return (
		<div className='flex items-start gap-2 rounded-8 bg-[#3C1C1C] p-2.5 text-13 leading-tight -tracking-2 text-[#FF3434]'>
			<TbAlertTriangle className='h-5 w-5 shrink-0' />
			<div className='flex flex-col gap-1'>
				<span className='font-semibold'>{t('storage-manager.scrub.error-title')}</span>
				<span className='text-white/60'>{t('storage-manager.scrub.errors-found', {count: errorCount})}</span>
			</div>
		</div>
	)
}
