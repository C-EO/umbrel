import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {useSystemDiskForUi} from '@/hooks/use-disk'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function StorageCardContent({headerIcon}: {headerIcon?: ReactNode}) {
	const {t} = useTranslation()
	const {value, valueSub, progress, isDiskLow, isDiskFull} = useSystemDiskForUi()

	return (
		<ProgressStatCardContent
			title={t('storage')}
			value={value}
			valueSub={valueSub}
			progress={progress}
			headerIcon={headerIcon}
			afterChildren={
				<>
					{isDiskLow && <span className={cardErrorClass}>{t('storage.low')}</span>}
					{isDiskFull && <span className={cardErrorClass}>{t('storage.full')}</span>}
				</>
			}
		/>
	)
}
