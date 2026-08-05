import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {useCpuForUi} from '@/hooks/use-cpu'

import {ProgressStatCardContent} from './progress-card-content'

export function CpuCardContent({headerIcon}: {headerIcon?: ReactNode}) {
	const {t} = useTranslation()
	const {value, progress} = useCpuForUi()

	return <ProgressStatCardContent title={t('cpu')} value={value} progress={progress} headerIcon={headerIcon} />
}
