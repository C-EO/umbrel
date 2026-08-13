import {Progress} from '@/components/ui/progress'
import {cn} from '@/lib/utils'

export function ProgressStatCardContent({
	title,
	value,
	valueSub,
	progress,
	afterChildren,
	headerIcon,
}: {
	title: string
	value?: string
	valueSub?: string
	progress: number
	afterChildren?: React.ReactNode
	headerIcon?: React.ReactNode
}) {
	const compactValue = (
		<span className='flex min-w-0 items-baseline gap-1 truncate font-medium text-white'>
			<span className='truncate'>{value}</span>
			<span className='truncate text-white/45'>{valueSub}</span>
		</span>
	)

	return (
		<div className={cn('flex flex-col', headerIcon ? 'gap-3' : 'gap-4')}>
			{headerIcon ? (
				<>
					<div className='flex min-w-0 items-start justify-between gap-3 text-13 -tracking-2'>
						<span className='min-w-0 truncate font-semibold text-white/45'>{title}</span>
						{headerIcon}
					</div>
					<div className='flex min-w-0 justify-start text-13 -tracking-2'>{compactValue}</div>
				</>
			) : (
				<div className='flex min-w-0 items-center justify-between gap-4 text-13 -tracking-2'>
					<span className='font-semibold text-white/45'>{title}</span>
					{compactValue}
				</div>
			)}
			<Progress value={progress * 100} size='thicker' variant='primary' trackClassName='bg-white/10' />
			{afterChildren}
		</div>
	)
}
