import {useTranslation} from 'react-i18next'

import {CloudIcon} from '@/features/files/assets/cloud-icon'
import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {useAnimatedNumber} from '@/features/files/hooks/use-animated-number'

import type {CloudIslandRow} from './index'

export function MinimizedContent({rows, totalPercent}: {rows: CloudIslandRow[]; totalPercent?: number}) {
	const {t} = useTranslation()
	const animatedPercent = useAnimatedNumber(totalPercent)
	const label = rows.length === 1 ? rows[0].name : t('files-cloud.island-count', {count: rows.length})

	return (
		<div className='flex size-full items-center gap-2 px-2'>
			<CircularProgress progress={animatedPercent ?? 0}>
				<CloudIcon className='size-3' />
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>{label}</span>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				{animatedPercent !== undefined && <span className='text-xs text-white/60'>{Math.round(animatedPercent)}%</span>}
			</div>
		</div>
	)
}
