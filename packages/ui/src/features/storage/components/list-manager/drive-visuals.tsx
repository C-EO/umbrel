import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import ssdChip from '@/features/storage/assets/ssd-chip.svg'
import {cn} from '@/lib/utils'

// Drive depictions for the list-based storage manager.

export type DriveLed = 'green' | 'amber' | 'red' | 'none'

// The drive enclosure render shared with the Files feature - verified against the Figma
// export to be the exact artwork the designs use. The healthy state is the asset as-is
// (green LED baked in at 78.7%/83.9%); the failed/missing state covers the LED with a red
// glow (the design achieves its red variant with overlays too - there is no red asset).
export function DriveIcon({led = 'none', className}: {led?: DriveLed; className?: string}) {
	return (
		<div className={cn('relative h-11 w-12 shrink-0', className)}>
			<img src={externalStorageIcon} alt='' draggable={false} className='size-full object-contain' />
			{(led === 'red' || led === 'amber') && (
				<span
					className={cn(
						'absolute size-[11%] rounded-full',
						led === 'red'
							? 'bg-[#FF3434] shadow-[0_0_6px_1px_rgba(255,52,52,0.8)]'
							: 'bg-[#F5A623] shadow-[0_0_6px_1px_rgba(245,166,35,0.8)]',
					)}
					style={{left: '78.7%', top: '83.9%', transform: 'translate(-50%, -50%)'}}
				/>
			)}
		</div>
	)
}

// The SSD chip vector exported from the Figma designs (body plus edge connector pins,
// 100x60). The capacity badge is overlaid so the label stays dynamic.
export function SsdChip({sizeLabel, className, led = 'none'}: {sizeLabel: string; className?: string; led?: DriveLed}) {
	return (
		<div className={cn('relative flex h-9 w-[60px] shrink-0 items-center justify-center', className)}>
			<img src={ssdChip} alt='' draggable={false} className='size-full object-fill' />
			<span className='absolute rounded-[5px] border border-white/15 bg-[#232326] px-2 py-0.5 text-[11px] font-semibold tracking-tight whitespace-nowrap text-white'>
				{sizeLabel}
			</span>
			{(led === 'red' || led === 'amber') && (
				<span
					className={cn(
						'absolute right-0.5 bottom-0.5 size-2 rounded-full',
						led === 'red'
							? 'bg-[#FF3434] shadow-[0_0_6px_1px_rgba(255,52,52,0.8)]'
							: 'bg-[#F5A623] shadow-[0_0_6px_1px_rgba(245,166,35,0.8)]',
					)}
				/>
			)}
		</div>
	)
}
