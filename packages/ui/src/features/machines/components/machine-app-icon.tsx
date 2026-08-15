import {OsIcon} from '@/features/machines/components/os-icon'
import {getOsVisuals} from '@/features/machines/constants'
import {cn} from '@/lib/utils'

export function MachineAppIcon({
	osId,
	className,
	badgeClassName,
}: {
	osId: string
	className?: string
	badgeClassName?: string
}) {
	const {color} = getOsVisuals(osId)

	return (
		<div
			className={cn('relative aspect-square shrink-0 ring-white/25 backdrop-blur-xs', className)}
			style={{background: `radial-gradient(circle at 50% 30%, ${color}55 0%, rgba(20,20,20,0.9) 85%)`}}
		>
			<OsIcon osId={osId} className='absolute-center size-[62%]' />
			<img
				src='/assets/dock/dock-machines.png'
				alt=''
				draggable={false}
				className={cn('absolute -top-[6%] -right-[6%] rounded-[25%] border-hpx border-white/25 shadow', badgeClassName)}
			/>
		</div>
	)
}
