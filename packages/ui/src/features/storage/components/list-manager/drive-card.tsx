import {useTranslation} from 'react-i18next'
import {TbPlus, TbRefreshDot} from 'react-icons/tb'

import {cn} from '@/lib/utils'

import {getDeviceHealth, RaidDevice, RaidDeviceStatus, raidStatusLabels, StorageDevice} from '../../hooks/use-storage'
import {formatStorageSize, hasRaidErrors} from '../../utils'
import {DriveIcon, DriveLed, HardDriveIcon, SsdChip} from './drive-visuals'

// Resolve the LED color for a drive from its RAID membership and health
function getDriveLed({
	inPool,
	raidStatus,
	hasHealthWarning,
	hasErrors,
}: {
	inPool: boolean
	raidStatus?: RaidDeviceStatus
	hasHealthWarning: boolean
	hasErrors: boolean
}): DriveLed {
	if (!inPool) return 'red'
	if ((raidStatus && raidStatus !== 'ONLINE') || hasHealthWarning) return 'red'
	if (hasErrors) return 'amber'
	return 'green'
}

// Pill shown on drives that are attached but not part of the pool
export function InactivePill({variant = 'neutral'}: {variant?: 'neutral' | 'destructive'}) {
	const {t} = useTranslation()
	return (
		<span
			className={cn(
				'rounded-full px-2.5 py-0.5 text-[12px] font-medium',
				variant === 'destructive' ? 'bg-[#FF3434]/15 text-[#FF3434]' : 'bg-white/10 text-white/60',
			)}
		>
			{t('storage-manager.inactive')}
		</span>
	)
}

// Small pill-shaped action button used on drive cards (Add / Replace)
export function DriveActionButton({
	icon: Icon,
	children,
	onClick,
	variant = 'default',
	disabled,
}: {
	icon: typeof TbPlus
	children: React.ReactNode
	onClick: () => void
	variant?: 'default' | 'primary' | 'destructive'
	disabled?: boolean
}) {
	return (
		<button
			type='button'
			disabled={disabled}
			onClick={(e) => {
				e.stopPropagation()
				onClick()
			}}
			className={cn(
				'flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-50',
				variant === 'primary' && 'animate-pulse border border-white/20 bg-white/15 text-white hover:bg-white/20',
				variant === 'destructive' && 'bg-[#FF3434] text-white hover:bg-[#FF3434]/90',
				variant === 'default' && 'border border-white/[0.08] bg-white/[0.06] text-white/80 hover:bg-white/10',
			)}
		>
			<Icon className='size-3.5' strokeWidth={2.5} />
			{children}
		</button>
	)
}

export const AddIcon = TbPlus
export const ReplaceIcon = TbRefreshDot

// A single drive row card used in Full Storage mode (and for SSD pools):
// [drive icon] [name / size · serial] ......... [pill + action]
export function DriveCard({
	device,
	raidDevice,
	inPool,
	onClick,
	action,
	pill,
}: {
	device: StorageDevice
	raidDevice?: RaidDevice
	inPool: boolean
	onClick?: () => void
	action?: React.ReactNode
	pill?: React.ReactNode
}) {
	const {hasWarning} = getDeviceHealth(device)
	const led = getDriveLed({
		inPool,
		raidStatus: raidDevice?.raidStatus,
		hasHealthWarning: hasWarning,
		hasErrors: hasRaidErrors(raidDevice),
	})

	// Not a <button> because the action slot renders its own buttons (nested buttons are invalid)
	return (
		<div
			onClick={onClick}
			className={cn(
				'flex w-full items-center gap-4 rounded-12 bg-white/5 p-4 text-left transition-colors',
				onClick && 'cursor-pointer hover:bg-white/10',
			)}
		>
			{device.type === 'hdd' ? <HardDriveIcon led={led} /> : <DriveIcon led={led} />}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>{device.name}</div>
				<div className='truncate text-13 text-white/50'>
					{formatStorageSize(device.size)} · {device.serial}
				</div>
			</div>
			{pill}
			{action}
		</div>
	)
}

// The disk umbrelOS runs from. Shown for health visibility on custom hardware (temps and
// SMART via the health dialog) but never usable for storage.
export function SystemDriveCard({device, onClick}: {device: StorageDevice; onClick?: () => void}) {
	const {t} = useTranslation()
	const {hasWarning} = getDeviceHealth(device)
	return (
		<div
			onClick={onClick}
			className={cn(
				'flex w-full items-center gap-4 rounded-12 bg-white/5 p-4 text-left transition-colors',
				onClick && 'cursor-pointer hover:bg-white/10',
			)}
		>
			{device.type === 'ssd' ? (
				<SsdChip sizeLabel={formatStorageSize(device.size)} />
			) : (
				<HardDriveIcon led={hasWarning ? 'red' : 'green'} />
			)}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>{device.name}</div>
				<div className='truncate text-13 text-white/50'>
					{formatStorageSize(device.size)} · {device.serial}
				</div>
			</div>
			<span className='rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] font-medium text-white/60'>
				{t('storage-manager.system-drive-pill')}
			</span>
		</div>
	)
}

// A pool member that has no attached physical device (drive was removed or died completely).
// Renders from RAID status alone.
export function MissingDriveCard({
	id,
	status,
	action,
	isHdd = false,
}: {
	id: string
	status?: RaidDeviceStatus
	action?: React.ReactNode
	/** The missing device is gone, so the pool's drive type decides the artwork */
	isHdd?: boolean
}) {
	const {t} = useTranslation()
	return (
		<div className='flex w-full items-center gap-4 rounded-12 border border-[#FF3434]/40 bg-[#FF3434]/10 p-4 text-left'>
			{isHdd ? <HardDriveIcon led='red' className='opacity-40' /> : <DriveIcon led='red' className='opacity-40' />}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>{t('storage-manager.missing-drive')}</div>
				<div className='truncate text-13 text-white/50'>{id}</div>
			</div>
			<span className='rounded-full bg-[#FF3434]/15 px-2.5 py-0.5 text-[12px] font-medium text-[#FF3434]'>
				{status && raidStatusLabels[status] ? t(raidStatusLabels[status]) : t('storage-manager.raid-status.removed')}
			</span>
			{action}
		</div>
	)
}
