import {Info, Plus, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Slider} from '@/components/ui/slider'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {OsIcon} from '@/features/machines/components/os-icon'
import {
	coreOptions,
	DEFAULT_CORES,
	DEFAULT_MEMORY_GB,
	MAX_DISK_SIZE_GB,
	MIN_MEMORY_GB,
} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachine, useMachineCapabilities, useMachines} from '@/features/machines/hooks/use-machines'
import type {Machine} from '@/features/machines/types'
import {createBrowserUuid} from '@/features/machines/utils'
import {useCpu} from '@/hooks/use-cpu'
import {useMemory} from '@/hooks/use-memory'
import {cn} from '@/lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

// Edit a machine's name and resources. Opened via ?dialog=machines-vm-settings&machines-vm-settings-id=<machineId>
export default function VmSettingsDialog() {
	const dialogProps = useDialogOpenProps('machines-vm-settings')
	const [searchParams] = useSearchParams()
	const machineId = searchParams.get('machines-vm-settings-id') ?? undefined
	const {machine} = useMachine(machineId)
	const {machines} = useMachines()
	const {capabilities} = useMachineCapabilities()
	const {updateSettings} = useMachineActions()
	const {threads} = useCpu()
	const {data: memory} = useMemory()

	const [name, setName] = useState('')
	const [cores, setCores] = useState(DEFAULT_CORES)
	const [memoryGb, setMemoryGb] = useState(DEFAULT_MEMORY_GB)
	const [firmware, setFirmware] = useState<'uefi' | 'bios'>('uefi')
	const [diskBus, setDiskBus] = useState<'virtio' | 'sata'>('virtio')
	// Kept as a string so the field can be cleared while typing (empty = invalid)
	const [diskInput, setDiskInput] = useState('')
	const [autostart, setAutostart] = useState(false)
	const [portForwards, setPortForwards] = useState<Machine['portForwards']>([])
	const [isSaving, setIsSaving] = useState(false)

	// Sync form state whenever the dialog opens for a machine
	useEffect(() => {
		if (!dialogProps.open || !machine) return
		setName(machine.name)
		setCores(machine.cores)
		setMemoryGb(machine.memoryGb)
		setFirmware(machine.firmware)
		setDiskBus(machine.diskBus ?? 'virtio')
		setDiskInput(String(machine.diskSizeGb))
		setAutostart(machine.autostart)
		setPortForwards(machine.portForwards)
	}, [dialogProps.open, machine?.id])

	if (!machine) return null

	// RAM ceiling: host total minus reserved (max of 2GB and current host usage).
	// Never below the machine's current allocation so its value stays selectable.
	const reservedBytes = Math.max(2e9, memory?.totalUsed ?? 0)
	const computedMaxMemoryGb = memory?.size ? Math.floor((memory.size - reservedBytes) / 1e9) : DEFAULT_MEMORY_GB
	const maxMemoryGb = Math.max(MIN_MEMORY_GB, machine.memoryGb, computedMaxMemoryGb)

	// Grow-only disk: min is the machine's current size (shrinking corrupts the guest FS)
	const trimmedName = name.trim()
	const nameEmpty = trimmedName === ''
	const nameTaken = machines.some(
		(other) => other.id !== machine.id && other.name.toLowerCase() === trimmedName.toLowerCase(),
	)
	const diskValue = Number(diskInput)
	const diskEmpty = diskInput.trim() === ''
	const diskShrink = !diskEmpty && Number.isFinite(diskValue) && diskValue < machine.diskSizeGb
	const diskValid =
		!diskEmpty && Number.isFinite(diskValue) && diskValue >= machine.diskSizeGb && diskValue <= MAX_DISK_SIZE_GB
	const forwardsValid = portForwards.every(
		(forward, index) =>
			forward.hostPort >= 40_000 &&
			forward.hostPort <= 49_999 &&
			forward.guestPort >= 1 &&
			forward.guestPort <= 65_535 &&
			portForwards.findIndex((other) => other.protocol === forward.protocol && other.hostPort === forward.hostPort) ===
				index,
	)

	// Settings can't change while the OS is being installed (backend rejects too)
	const isInstalling = machine.state === 'installing'
	const hasFixedMemory = machine.platformProfile === 'windows-98-x86'

	const canSave = !isSaving && !isInstalling && !nameEmpty && !nameTaken && diskValid && forwardsValid

	const handleSave = async () => {
		if (!canSave) return
		setIsSaving(true)
		try {
			await updateSettings({
				id: machine.id,
				name: trimmedName,
				cores,
				...(!hasFixedMemory && {memoryGb}),
				diskSizeGb: Math.round(diskValue),
				autostart,
				...(machine.osId === 'custom' ? {firmware, diskBus} : {}),
				portForwards,
			})
			toast.success(t('machines.settings-saved'))
			dialogProps.onOpenChange(false)
		} catch {
			// Error toast is handled by the mutation
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='flex flex-col gap-5'>
				<DialogHeader>
					<div className='flex items-center gap-3'>
						<OsIcon osId={machine.osId} className='size-10' />
						<div className='flex flex-col gap-1'>
							<DialogTitle>{t('machines.settings-title', {name: machine.name})}</DialogTitle>
							<DialogDescription>{machine.osVersion}</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<div className='flex flex-col gap-2'>
					<Label htmlFor='machine-name' className='text-13 text-white/70'>
						{t('machines.vm-name')}
					</Label>
					<Input
						id='machine-name'
						value={name}
						onChange={(e) => setName(e.target.value)}
						disabled={isSaving}
						maxLength={100}
					/>
					{nameTaken && <span className='text-12 text-destructive2-lightest'>{t('machines.name-taken')}</span>}
				</div>

				{machine.osId === 'custom' && (
					<div className='grid grid-cols-2 gap-4'>
						<div className='flex flex-col gap-2'>
							<Label className='text-13 text-white/70'>{t('machines.firmware')}</Label>
							<div className='grid grid-cols-2 gap-2'>
								{(['uefi', 'bios'] as const).map((option) => (
									<button
										key={option}
										type='button'
										disabled={isSaving || (machine.arch === 'arm64' && option === 'bios')}
										onClick={() => setFirmware(option)}
										className={cn(
											'h-9 rounded-full border text-11 font-semibold uppercase transition-colors disabled:opacity-35',
											firmware === option
												? 'border-brand bg-brand/20 text-white'
												: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10',
										)}
									>
										{option}
									</button>
								))}
							</div>
						</div>
						<div className='flex flex-col gap-2'>
							<Label className='text-13 text-white/70'>{t('machines.disk-compatibility')}</Label>
							<div className='grid grid-cols-2 gap-2'>
								{(['virtio', 'sata'] as const).map((option) => (
									<button
										key={option}
										type='button'
										disabled={isSaving || (machine.arch === 'arm64' && option === 'sata')}
										onClick={() => setDiskBus(option)}
										className={cn(
											'h-9 rounded-full border text-11 font-semibold uppercase transition-colors disabled:opacity-35',
											diskBus === option
												? 'border-brand bg-brand/20 text-white'
												: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10',
										)}
									>
										{option}
									</button>
								))}
							</div>
						</div>
					</div>
				)}

				{machine.diskPath && (
					<div className='rounded-12 border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-12 leading-snug text-amber-100/80'>
						<p className='truncate font-medium'>{machine.diskPath}</p>
						<p className='mt-1 text-amber-100/60'>{t('machines.external-install-warning')}</p>
					</div>
				)}

				<div className='flex flex-col gap-2'>
					<Label className='text-13 text-white/70'>{t('machines.cores')}</Label>
					<div className='flex flex-wrap gap-2'>
						{coreOptions(threads || DEFAULT_CORES).map((option) => (
							<button
								key={option}
								type='button'
								disabled={isSaving}
								onClick={() => setCores(option)}
								className={cn(
									'h-[30px] rounded-full border px-4 text-13 font-medium transition-colors',
									cores === option
										? 'border-brand bg-brand/20 text-white'
										: 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
								)}
							>
								{t('machines.cores-count', {count: option})}
							</button>
						))}
					</div>
				</div>

				<div className='flex flex-col gap-2.5'>
					<div className='flex items-center justify-between'>
						<Label className='text-13 text-white/70'>{t('machines.memory')}</Label>
						<span className='text-13 text-white/70 tabular-nums'>{t('machines.gb', {value: memoryGb})}</span>
					</div>
					<Slider
						min={MIN_MEMORY_GB}
						max={maxMemoryGb}
						step={1}
						value={[memoryGb]}
						onValueChange={([value]) => setMemoryGb(value)}
						disabled={isSaving || hasFixedMemory}
						aria-label={t('machines.memory')}
					/>
				</div>

				<p className='-mt-2 text-12 -tracking-2 text-white/40'>{t('machines.applies-after-restart')}</p>

				<div className='flex flex-col gap-2'>
					<Label htmlFor='machine-disk' className='text-13 text-white/70'>
						{t('machines.disk-size')}
					</Label>
					<div className='relative'>
						<Input
							id='machine-disk'
							type='number'
							min={machine.diskSizeGb}
							max={MAX_DISK_SIZE_GB}
							value={diskInput}
							onChange={(e) => setDiskInput(e.target.value)}
							disabled={isSaving}
							className='pr-12'
						/>
						<span className='absolute top-1/2 right-4 -translate-y-1/2 text-13 text-white/40'>GB</span>
					</div>
					{diskShrink && (
						<span className='text-12 text-destructive2-lightest'>
							{t('machines-error.machine-disk-shrink-not-allowed')}
						</span>
					)}
				</div>

				<div className='flex items-center justify-between gap-4'>
					<Label htmlFor='machine-autostart' className='text-13 text-white/70'>
						{t('machines.autostart')}
					</Label>
					<Switch id='machine-autostart' checked={autostart} onCheckedChange={setAutostart} disabled={isSaving} />
				</div>

				<div className='flex flex-col gap-2'>
					<div className='flex items-center justify-between'>
						<div>
							<Label className='text-13 text-white/70'>{t('machines.port-forwards')}</Label>
							<p className='text-11 text-white/35'>{t('machines.port-range')}</p>
						</div>
						<Button
							size='sm'
							onClick={() => {
								const used = new Set(portForwards.map((forward) => forward.hostPort))
								let hostPort = 40_000
								while (used.has(hostPort) && hostPort <= 49_999) hostPort++
								setPortForwards((forwards) => [
									...forwards,
									{id: createBrowserUuid(), protocol: 'tcp', hostPort, guestPort: 22},
								])
							}}
							disabled={isSaving || portForwards.length >= 32}
						>
							<Plus className='mr-1 size-3.5' />
							{t('machines.add-forward')}
						</Button>
					</div>
					{portForwards.map((forward) => (
						<div key={forward.id} className='grid grid-cols-[70px_1fr_auto_1fr_32px] items-center gap-2'>
							<button
								type='button'
								className='h-9 rounded-full border border-white/10 bg-white/5 text-11 font-semibold text-white/70 uppercase'
								onClick={() =>
									setPortForwards((forwards) =>
										forwards.map((item) =>
											item.id === forward.id ? {...item, protocol: item.protocol === 'tcp' ? 'udp' : 'tcp'} : item,
										),
									)
								}
							>
								{forward.protocol}
							</button>
							<Input
								type='number'
								value={forward.hostPort}
								onChange={(event) =>
									setPortForwards((forwards) =>
										forwards.map((item) =>
											item.id === forward.id ? {...item, hostPort: Number(event.target.value)} : item,
										),
									)
								}
								aria-label={t('machines.host-port')}
							/>
							<span className='text-12 text-white/30'>→</span>
							<Input
								type='number'
								value={forward.guestPort}
								onChange={(event) =>
									setPortForwards((forwards) =>
										forwards.map((item) =>
											item.id === forward.id ? {...item, guestPort: Number(event.target.value)} : item,
										),
									)
								}
								aria-label={t('machines.guest-port')}
							/>
							<button
								type='button'
								className='grid size-8 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white'
								onClick={() => setPortForwards((forwards) => forwards.filter((item) => item.id !== forward.id))}
								aria-label={t('remove')}
							>
								<Trash2 className='size-3.5' />
							</button>
						</div>
					))}
					{!forwardsValid && <p className='text-12 text-destructive2-lightest'>{t('machines.port-invalid')}</p>}
					{machine.osId.startsWith('windows') && (
						<p className='text-11 leading-relaxed text-white/35'>{t('machines.windows-rdp-forward')}</p>
					)}
					{capabilities?.guestHostAddress && (
						<div className='mt-1 flex gap-2 rounded-12 bg-white/5 px-3 py-2.5 text-white/45'>
							<Info className='mt-0.5 size-3.5 shrink-0' />
							<div className='space-y-1 text-11 leading-relaxed'>
								<p>{t('machines.machine-ip-address', {address: machine.ipAddress})}</p>
								<p>{t('machines.guest-host-address', {address: capabilities.guestHostAddress})}</p>
							</div>
						</div>
					)}
				</div>

				{isInstalling && (
					<p className='text-12 -tracking-2 text-white/40'>{t('machines.settings-unavailable-installing')}</p>
				)}

				<DialogFooter>
					<Button variant='primary' size='dialog' onClick={handleSave} disabled={!canSave}>
						{t('machines.settings-save')}
					</Button>
					<Button size='dialog' onClick={() => dialogProps.onOpenChange(false)} disabled={isSaving}>
						{t('cancel')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
