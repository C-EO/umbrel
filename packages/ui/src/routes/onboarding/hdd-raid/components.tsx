import {HardDriveIcon, SsdChip} from '@/features/storage/components/list-manager/drive-visuals'
import {cn} from '@/lib/utils'

import {formatSize, StorageDevice} from '../raid/use-raid-setup'

// The scaffold all HDD RAID screens render inside. Content sits directly on the
// onboarding card - no nested surface - matching the Pro and SSD RAID screens; the
// optional footer (stats left, actions right) is separated by a hairline divider.
export function ModalShell({footer, children}: {footer?: React.ReactNode; children: React.ReactNode}) {
	return (
		<div className='flex w-full max-w-[1000px] flex-1 flex-col self-center px-4 py-6 md:px-6 md:pt-10 md:pb-4'>
			<div className='umbrel-stable-gutter flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto'>{children}</div>
			{footer && (
				<div className='mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5'>
					{footer}
				</div>
			)}
		</div>
	)
}

export function StepHeader({
	title,
	titleExtra,
	subTitle,
	className,
}: {
	title: string
	titleExtra?: React.ReactNode
	subTitle?: React.ReactNode
	className?: string
}) {
	return (
		<div className={cn('flex flex-col gap-1 md:gap-2', className)}>
			{/* Same heading treatment as the Pro and SSD RAID screens. titleExtra renders
			    inline so a suffix like "(Optional)" wraps naturally with the title text. */}
			<h1
				className='text-[20px] font-bold text-white/85 md:text-[24px]'
				style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
			>
				{title}
				{titleExtra && <> {titleExtra}</>}
			</h1>
			{subTitle && <p className='max-w-[640px] text-[14px] text-white/50 md:text-[16px]'>{subTitle}</p>}
		</div>
	)
}

// A detected device row: hard drive artwork for HDDs, chip for SSDs so acceleration
// candidates are visually distinct from data drives
export function FoundDeviceCard({device}: {device: StorageDevice}) {
	return (
		<div className='flex w-full items-center gap-3 rounded-xl bg-white/5 p-3.5'>
			{device.type === 'ssd' ? <SsdChip sizeLabel={formatSize(device.roundedSize)} /> : <HardDriveIcon led='green' />}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>{device.name}</div>
				<div className='truncate text-13 text-white/40'>
					{formatSize(device.roundedSize)} · {device.serial}
				</div>
			</div>
		</div>
	)
}
