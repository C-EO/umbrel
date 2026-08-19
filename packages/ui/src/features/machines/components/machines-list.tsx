import {Disc3, Loader2, MoreHorizontal, Pin, PinOff, Power, Settings, Square, Trash2} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {TbAlertTriangleFilled} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Progress} from '@/components/ui/progress'
import {toast} from '@/components/ui/toast'
import {MachineStateBadge} from '@/features/machines/components/machine-state-badge'
import {MachinesTooltip} from '@/features/machines/components/machines-tooltip'
import {OsIcon} from '@/features/machines/components/os-icon'
import {
	layoutMorphTransition,
	machinePath,
	machineRowButtonClass,
	machineStopBgClass,
} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import type {Machine} from '@/features/machines/types'
import {prettyMbPair} from '@/features/machines/utils'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function MachinesList({machines}: {machines: Machine[]}) {
	return (
		<div className='flex flex-col gap-3 p-6 md:p-12'>
			<h2 className='text-17 font-semibold -tracking-2 text-white/85'>{t('machines.installed-vms')}</h2>
			<div className='grid grid-cols-1 gap-3 lg:grid-cols-2'>
				<AnimatePresence mode='popLayout' initial={true}>
					{machines.map((machine, i) => (
						<MachineRow key={machine.id} machine={machine} index={i} />
					))}
				</AnimatePresence>
			</div>
		</div>
	)
}

function MachineRow({machine, index}: {machine: Machine; index: number}) {
	const navigate = useNavigate()
	const isError = machine.state === 'error'

	return (
		// Non-interactive container: the primary open affordance is a real button
		// (activates on Enter *and* Space) whose stretched ::after covers the row,
		// while the action buttons sit above it in their own z-layer.
		<motion.div
			// Rows glide to their new spot when a sibling is added/removed
			// (position-only: row size never changes, so no scale distortion)
			layout='position'
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}
			transition={{delay: index * 0.02, duration: 0.2, ease: 'easeOut', ...layoutMorphTransition}}
			className={cn(
				'relative flex items-center justify-between gap-3 rounded-20 border border-white/10 bg-white/6 p-4 text-left transition-colors duration-300 hover:border-white/15 hover:bg-white/10',
				isError && 'border-[#f63636]/40 bg-[#f63636]/[0.08] hover:border-[#f63636]/50 hover:bg-[#f63636]/[0.12]',
			)}
		>
			<button
				type='button'
				onClick={() => navigate(machinePath(machine.id))}
				className='flex min-w-0 cursor-pointer items-center gap-2.5 text-left after:absolute after:inset-0 after:rounded-20 focus:outline-hidden focus-visible:after:ring-3 focus-visible:after:ring-white/20'
			>
				<OsIcon osId={machine.osId} state={machine.state} className='size-10 md:size-12' />
				<div className='flex min-w-0 flex-col gap-1'>
					<div className='flex min-w-0 items-center gap-[7px]'>
						<span className='min-w-0 truncate text-15 font-medium -tracking-2 text-white'>{machine.name}</span>
						<MachineStateBadge state={machine.state} />
					</div>
					<div className='flex min-w-0 items-center gap-1.5 text-13 font-medium -tracking-2 text-white/40'>
						<span className='truncate'>{machine.osVersion}</span>
						{machine.acceleration === 'tcg' && (
							<>
								<span className='size-[3px] shrink-0 rounded-full bg-white/25' />
								<span className='shrink-0 text-amber-300/70'>{t('machines.emulated')}</span>
							</>
						)}
					</div>
				</div>
			</button>
			<div className='relative z-10 flex items-center gap-1.5 md:gap-2'>
				{machine.state === 'installing' ? (
					<>
						<div className='flex w-32 items-center gap-2 pr-1'>
							<Progress value={machine.installProgress ?? 0} />
						</div>
						<MachineMenu machine={machine} />
					</>
				) : (
					<>
						<MachineMenu machine={machine} />
						<MachinePowerButton machine={machine} />
					</>
				)}
			</div>
		</motion.div>
	)
}

function MachinePowerButton({machine}: {machine: Machine}) {
	const {start, stop, retryInstall} = useMachineActions()

	if (machine.state === 'running') {
		return (
			<MachinesTooltip label={t('machines.stop')}>
				<button
					className={machineRowButtonClass}
					onClick={() => stop({id: machine.id})}
					aria-label={t('machines.stop')}
				>
					<div className={cn('size-[13px] rounded-[4px] md:size-[15px]', machineStopBgClass)} />
				</button>
			</MachinesTooltip>
		)
	}

	// Both 'stopped' and 'error' get a one-click start (error recovery)
	if (machine.state === 'stopped' || machine.state === 'error') {
		const retryingInstall = machine.state === 'error' && machine.installPending
		const label = retryingInstall
			? t('machines.retry-install')
			: machine.state === 'error'
				? t('machines.start-again')
				: t('machines.start')
		return (
			<MachinesTooltip label={label}>
				<button
					className={machineRowButtonClass}
					onClick={() => (retryingInstall ? retryInstall({id: machine.id}) : start({id: machine.id}))}
					aria-label={label}
				>
					<Power className='size-4 md:size-5' />
				</button>
			</MachinesTooltip>
		)
	}

	return (
		<button className={machineRowButtonClass} disabled>
			<Loader2 className='size-4 animate-spin md:size-5' />
		</button>
	)
}

// Uninstall confirmation flow, shared by the list menu and the rail's
// "Cancel install" affordance (uninstall doubles as cancel-install).
export function useUninstallMachine(machine: Machine) {
	const confirm = useConfirmation()
	const {uninstall} = useMachineActions()

	return async () => {
		try {
			const {actionValue} = await confirm({
				title: t('machines.uninstall-confirm-title', {name: machine.name}),
				message: t('machines.uninstall-confirm-message'),
				icon: TbAlertTriangleFilled,
				actions: [
					{label: t('machines.uninstall'), value: 'uninstall', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (actionValue === 'uninstall') await uninstall({id: machine.id})
		} catch {
			// User dismissed the dialog
		}
	}
}

function useEjectInstallMedia(machine: Machine) {
	const confirm = useConfirmation()
	const {ejectInstallMedia} = useMachineActions()

	return async () => {
		try {
			const {actionValue} = await confirm({
				title: t('machines.eject-install-media-confirm-title'),
				message: t('machines.eject-install-media-confirm-message'),
				actions: [
					{label: t('machines.eject-install-media'), value: 'eject', variant: 'default'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (actionValue !== 'eject') return
			await ejectInstallMedia({id: machine.id})
			toast.success(t('machines.install-media-ejected'), {area: 'machines'})
		} catch {
			// User dismissed the dialog or the mutation's onError toast owns the failure.
		}
	}
}

export function MachineMenu({machine, buttonClassName}: {machine: Machine; buttonClassName?: string}) {
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const {setPinned, forceStop} = useMachineActions()
	const handleUninstall = useUninstallMachine(machine)
	const handleEjectInstallMedia = useEjectInstallMedia(machine)

	const storagePercent = machine.diskSizeGb > 0 ? (machine.storageUsedGb / machine.diskSizeGb) * 100 : 0
	// Compact "used/total" pair, e.g. "2.57/4 GB" (or "350 MB/4 GB" below a gig)
	const {downloaded: storageUsed, total: storageTotal} = prettyMbPair(
		machine.storageUsedGb * 1_000,
		machine.diskSizeGb * 1_000,
	)

	return (
		<DropdownMenu>
			<MachinesTooltip label={t('machines.machine-options')}>
				<DropdownMenuTrigger asChild>
					<button className={buttonClassName ?? machineRowButtonClass} aria-label={t('machines.machine-options')}>
						<MoreHorizontal className='size-4 md:size-5' />
					</button>
				</DropdownMenuTrigger>
			</MachinesTooltip>
			<DropdownMenuContent align='start' className='w-60'>
				<div className='mb-1 flex flex-col gap-2 rounded-8 bg-white/8 p-2'>
					<div className='flex items-center justify-between'>
						<span className='text-13 font-medium -tracking-2 text-white'>{t('machines.storage')}</span>
						<span className='text-11 font-semibold text-white'>
							{storageUsed}
							<span className='text-white/40'>/{storageTotal}</span>
						</span>
					</div>
					<Progress value={storagePercent} size='thicker' variant='primary' />
				</div>
				{machine.performanceWarning && (
					<div className='mb-1 rounded-8 border border-amber-400/20 bg-amber-400/10 p-2 text-12 leading-snug text-amber-200/90'>
						{machine.performanceWarning}
					</div>
				)}
				<DropdownMenuItem
					className='gap-2 whitespace-nowrap'
					onSelect={() => navigate(linkToDialog('machines-vm-settings', {id: machine.id}))}
				>
					<Settings className='size-4 shrink-0' />
					{t('machines.settings')}
				</DropdownMenuItem>
				<DropdownMenuItem
					className='gap-2 whitespace-nowrap'
					onSelect={() => setPinned({id: machine.id, pinned: !machine.pinned})}
				>
					{machine.pinned ? <PinOff className='size-4 shrink-0' /> : <Pin className='size-4 shrink-0' />}
					{machine.pinned ? t('machines.unpin-from-homescreen') : t('machines.pin-to-homescreen')}
				</DropdownMenuItem>
				{machine.installationMediaAttached && !machine.firstBootSetup && machine.state !== 'installing' && (
					<DropdownMenuItem className='gap-2 whitespace-nowrap' onSelect={handleEjectInstallMedia}>
						<Disc3 className='size-4 shrink-0' />
						{t('machines.eject-install-media')}
					</DropdownMenuItem>
				)}
				{/* Force stop: the escape hatch for any non-stopped state — except
				   'installing', where "Cancel install" (uninstall) is the right action */}
				{machine.state !== 'stopped' && machine.state !== 'installing' && (
					<DropdownMenuItem
						className='gap-2 whitespace-nowrap text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
						onSelect={() => forceStop({id: machine.id})}
					>
						<Square className='size-4 shrink-0 fill-current' />
						{t('machines.force-stop')}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					className='gap-2 whitespace-nowrap text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
					onSelect={handleUninstall}
				>
					<Trash2 className='size-4 shrink-0' />
					{t('machines.uninstall')}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
