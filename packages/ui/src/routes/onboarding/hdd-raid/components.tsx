import {DriveIcon, SsdChip} from '@/features/storage/components/list-manager/drive-visuals'
import {cn} from '@/lib/utils'

import {formatSize, StorageDevice} from '../raid/use-raid-setup'

// The onboarding modal card all HDD RAID screens render inside: content area with
// heading, and an optional full-width footer strip with stats on the left and actions
// on the right (per the Figma designs).
export function ModalShell({footer, children}: {footer?: React.ReactNode; children: React.ReactNode}) {
	return (
		<div className='flex w-full max-w-[1000px] flex-1 flex-col self-center px-3 py-4 md:px-8 md:py-8'>
			<div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-black/40 shadow-2xl backdrop-blur-2xl'>
				<div className='umbrel-stable-gutter flex flex-1 flex-col gap-4 overflow-y-auto p-5 md:p-8'>{children}</div>
				{footer && (
					<div className='flex flex-wrap items-center justify-between gap-3 border-t border-white/6 bg-black/20 px-5 py-4 md:px-8'>
						{footer}
					</div>
				)}
			</div>
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
		<div className={cn('flex flex-col gap-1', className)}>
			<h1 className='flex items-center gap-2 text-[22px] font-bold text-white/90 md:text-[24px]'>
				{title}
				{titleExtra}
			</h1>
			{subTitle && <p className='max-w-[640px] text-13 leading-relaxed text-white/40'>{subTitle}</p>}
		</div>
	)
}

// A detected device row: enclosure artwork for HDDs, chip for SSDs so acceleration
// candidates are visually distinct from data drives
export function FoundDeviceCard({device}: {device: StorageDevice}) {
	return (
		<div className='flex w-full items-center gap-3 rounded-xl bg-white/5 p-3.5'>
			{device.type === 'ssd' ? <SsdChip sizeLabel={formatSize(device.roundedSize)} /> : <DriveIcon led='green' />}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>{device.name}</div>
				<div className='truncate text-13 text-white/40'>
					{formatSize(device.roundedSize)} · {device.serial}
				</div>
			</div>
		</div>
	)
}
