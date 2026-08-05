import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {useSystemMemoryForUi} from '@/hooks/use-memory'

import {ProgressStatCardContent} from './progress-card-content'
import {cardErrorClass} from './shared'

export function MemoryCardContent({headerIcon}: {headerIcon?: ReactNode}) {
	const {t} = useTranslation()
	const {value, valueSub, progress, isMemoryLow} = useSystemMemoryForUi()

	return (
		<ProgressStatCardContent
			title={t('memory')}
			value={value}
			valueSub={valueSub}
			progress={progress}
			headerIcon={headerIcon}
			afterChildren={isMemoryLow && <span className={cardErrorClass}>{t('memory.low')}</span>}
		/>
	)
}
