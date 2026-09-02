import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import activeNasIcon from '@/features/files/assets/nas-icon-active.png'
import inactiveNasIcon from '@/features/files/assets/nas-icon-inactive.png'
import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {cn} from '@/lib/utils'

export function StorageLocation({
	path,
	name,
	connected = true,
	className,
	iconClassName,
}: {
	path: string
	name?: string
	connected?: boolean
	className?: string
	iconClassName?: string
}) {
	const parts = path.split('/').filter(Boolean)
	const isExternal = parts[0] === EXTERNAL_STORAGE_PATH.slice(1) && parts.length >= 2
	const isNetwork = parts[0] === NETWORK_STORAGE_PATH.slice(1) && parts.length >= 3

	if (!isExternal && !isNetwork) return <span title={path}>{path}</span>

	const icon = isExternal ? externalStorageIcon : connected ? activeNasIcon : inactiveNasIcon
	const label = isExternal ? (name ?? parts[1]) : `${name ?? parts[2]} (${parts[1]})`

	return (
		<span className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5', className)} title={path}>
			<img src={icon} alt='' className={cn('size-3.5 shrink-0 object-contain', iconClassName)} draggable={false} />
			<span className='truncate'>{label}</span>
		</span>
	)
}
