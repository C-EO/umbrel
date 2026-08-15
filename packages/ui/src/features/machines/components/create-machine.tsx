import {ChevronDown, TriangleAlert} from 'lucide-react'
import {motion} from 'motion/react'
import {lazy, Suspense, useEffect, useState} from 'react'
import {Navigate, useNavigate, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Spinner} from '@/components/ui/loading'
import {Slider} from '@/components/ui/slider'
import {OsIcon} from '@/features/machines/components/os-icon'
import {
	coreOptions,
	DEFAULT_CORES,
	DEFAULT_DISK_SIZE_GB,
	DEFAULT_MEMORY_GB,
	machinePath,
	MACHINES_PATH,
	MAX_DISK_SIZE_GB,
	MIN_MEMORY_GB,
} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachineCapabilities, useMachines, useOsImages} from '@/features/machines/hooks/use-machines'
import {stripDiskImageExtension} from '@/features/machines/utils'
import {useCpu} from '@/hooks/use-cpu'
import {useMemory} from '@/hooks/use-memory'
import {t} from '@/utils/i18n'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((m) => ({default: m.MiniBrowser})),
)

function nextAvailableName(base: string, existingNames: string[]) {
	const used = new Set(existingNames.map((value) => value.trim().toLowerCase()))
	if (!used.has(base.toLowerCase())) return base
	for (let suffix = 2; ; suffix++) {
		const candidate = `${base} ${suffix}`
		if (!used.has(candidate.toLowerCase())) return candidate
	}
}

// Configure and create a machine from any catalog image (?os=<osId>) or a
// custom installer/disk image file (?iso=<path>). Catalog downloads begin only
// after submission, so users never have to babysit a separate pre-cache step.
export default function CreateMachine() {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const osId = searchParams.get('os')
	const isoPath = searchParams.get('iso')

	const {osImages, isLoading} = useOsImages()
	const {capabilities} = useMachineCapabilities()
	const {machines} = useMachines()
	const {create} = useMachineActions()
	const {threads} = useCpu()
	const {data: memoryData} = useMemory()

	const osImage = osId ? osImages.find((image) => image.id === osId) : undefined

	// Catalog images can use credentials to preconfigure the guest. A manual
	// installer may only be able to prefill the username; custom images never do.
	const requiresCredentials = !!osImage?.requiresCredentials
	const manualSetup = !!osImage?.manualSetup
	const requiresPassword = requiresCredentials && !manualSetup
	const requiresLicenseKey = !!osImage?.requiresLicenseKey
	const requiresWindowsUsername = osImage?.platform === 'windows'
	const fixedMemoryGb = osImage?.fixedMemoryMb ? osImage.fixedMemoryMb / 1_024 : undefined

	// RAM slider bounds: 1GB → (host total − reserved), reserving max(2GB, used)
	const reservedBytes = Math.max(2e9, memoryData?.totalUsed ?? 0)
	const maxMemoryGb = memoryData
		? Math.max(MIN_MEMORY_GB, Math.floor((memoryData.size - reservedBytes) / 1e9))
		: undefined

	const [name, setName] = useState<string | null>(null)
	const [diskSizeInput, setDiskSizeInput] = useState(String(DEFAULT_DISK_SIZE_GB))
	const [cores, setCores] = useState(DEFAULT_CORES)
	const [memoryGb, setMemoryGb] = useState(DEFAULT_MEMORY_GB)
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const [licenseKey, setLicenseKey] = useState('')
	const [arch, setArch] = useState<'amd64' | 'arm64' | null>(null)
	const [firmware, setFirmware] = useState<'uefi' | 'bios'>('uefi')
	const [diskBus, setDiskBus] = useState<'virtio' | 'sata'>('virtio')
	const [diskDirectory, setDiskDirectory] = useState<string>()
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [diskBrowserOpen, setDiskBrowserOpen] = useState(false)
	const [isCreating, setIsCreating] = useState(false)

	// Once the host's usable memory is known, clamp the default down if the host
	// is small
	useEffect(() => {
		if (maxMemoryGb !== undefined) setMemoryGb((value) => Math.min(value, maxMemoryGb))
	}, [maxMemoryGb])

	if (isLoading) {
		return (
			<div className='grid min-h-[320px] w-full place-items-center p-12'>
				<Spinner />
			</div>
		)
	}

	// Invalid deep links go back to the catalog. Any real catalog state is valid:
	// create joins an active download or starts/retries one in the background.
	const validOsSource = osImage
	if (!validOsSource && !isoPath) return <Navigate to={MACHINES_PATH} replace />

	const sourceName = osImage
		? osImage.variantName
			? `${osImage.name} ${osImage.variantName}`
			: osImage.name
		: stripDiskImageExtension(isoPath!.split('/').pop() ?? '')
	const customSourceType = isoPath ? (/\.iso$/i.test(isoPath) ? 'installer' : 'disk-image') : undefined
	const sourceVersion =
		osImage?.version ??
		(customSourceType === 'installer'
			? t('machines.custom-installer-iso')
			: customSourceType === 'disk-image'
				? t('machines.custom-disk-image')
				: undefined)
	const sourceOsIconId = osImage && !osImage.custom ? osImage.familyId : 'custom'
	const isCustomSource = !!isoPath || !!osImage?.custom
	const selectedArch = isCustomSource ? (arch ?? capabilities?.hostArchitecture ?? 'amd64') : osImage?.arch
	const softwareEmulated =
		selectedArch !== undefined &&
		(selectedArch !== capabilities?.hostArchitecture ||
			(selectedArch === capabilities?.hostArchitecture && capabilities?.kvmAvailable === false))

	const defaultName = nextAvailableName(
		t('machines.default-vm-name', {os: sourceName}),
		machines.map((machine) => machine.name),
	)
	const nameValue = name ?? defaultName
	const trimmedName = nameValue.trim()

	// Validation
	const diskSizeGb = Number(diskSizeInput)
	const diskSizeValid = diskSizeInput !== '' && Number.isInteger(diskSizeGb) && diskSizeGb >= 1
	const nameTaken =
		!isCreating && machines.some((machine) => machine.name.trim().toLowerCase() === trimmedName.toLowerCase())
	const usernameValid =
		username.trim() !== '' && (!requiresWindowsUsername || /^[a-z0-9][a-z0-9_.-]{0,19}$/i.test(username.trim()))
	const licenseKeyValid = !requiresLicenseKey || /^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/i.test(licenseKey.trim())
	const credentialsValid =
		(!requiresCredentials || (usernameValid && (!requiresPassword || password !== ''))) && licenseKeyValid

	const canCreate = !isCreating && !!trimmedName && !nameTaken && diskSizeValid && credentialsValid

	// Keep the number field usable while typing: digits only, transient empty
	// allowed, capped at the max
	const handleDiskChange = (raw: string) => {
		const digits = raw.replace(/[^0-9]/g, '')
		if (digits === '') return setDiskSizeInput('')
		setDiskSizeInput(String(Math.min(Number(digits), MAX_DISK_SIZE_GB)))
	}

	const handleCreate = async () => {
		if (!canCreate) return
		setIsCreating(true)
		try {
			const machine = await create({
				name: trimmedName,
				...(osImage ? {osId: osImage.id} : {imagePath: isoPath!}),
				diskSizeGb,
				cores,
				memoryGb,
				arch: selectedArch,
				...(isCustomSource && {
					firmware: selectedArch === 'arm64' ? 'uefi' : firmware,
					diskBus: selectedArch === 'arm64' ? 'virtio' : diskBus,
					...(diskDirectory ? {diskDirectory} : {}),
				}),
				...(requiresCredentials ? {username: username.trim(), ...(requiresPassword ? {password} : {})} : {}),
				...(requiresLicenseKey ? {licenseKey: licenseKey.trim().toUpperCase()} : {}),
			})
			navigate(machinePath(machine.id), {replace: true})
		} catch {
			// Error toast is handled by the mutation
			setIsCreating(false)
		}
	}

	return (
		<motion.div
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			transition={{duration: 0.2, ease: 'easeOut'}}
			className='flex flex-col items-center p-6 py-10 md:p-12'
		>
			<div className='flex w-full max-w-[560px] flex-col gap-5'>
				{/* Selected OS */}
				<div className='flex items-center justify-between gap-3 rounded-15 border border-white/10 bg-white/6 p-4'>
					<div className='flex min-w-0 items-center gap-3'>
						<OsIcon osId={sourceOsIconId} className='size-10' />
						<div className='flex min-w-0 flex-col gap-1'>
							<span className='truncate text-15 leading-none font-medium -tracking-2 text-white'>{sourceName}</span>
							<span className='truncate text-13 leading-none -tracking-2 text-white/40'>{sourceVersion}</span>
						</div>
					</div>
				</div>

				{customSourceType && (
					<div className='rounded-12 border border-white/10 bg-white/6 p-3 text-12 leading-snug -tracking-2 text-white/55'>
						{customSourceType === 'installer'
							? t('machines.custom-installer-description')
							: t('machines.custom-disk-image-description')}
					</div>
				)}

				{manualSetup && (
					<div className='flex gap-3 rounded-12 border border-amber-400/20 bg-amber-400/10 p-3 text-amber-100/90'>
						<TriangleAlert className='mt-0.5 size-4 shrink-0' />
						<div className='flex flex-col gap-1'>
							<span className='text-13 font-medium'>{t('machines.manual-setup-title')}</span>
							<span className='text-12 leading-snug -tracking-2 text-amber-100/70'>
								{t('machines.manual-setup-description')}
							</span>
						</div>
					</div>
				)}

				{/* Name */}
				<div className='flex flex-col gap-2'>
					<Label htmlFor='vm-name' className='text-13 text-white/60'>
						{t('machines.vm-name')}
					</Label>
					<Input
						id='vm-name'
						value={nameValue}
						onChange={(e) => setName(e.target.value)}
						disabled={isCreating}
						maxLength={100}
						autoFocus
					/>
					{nameTaken && (
						<span className='px-[5px] text-13 -tracking-2 text-destructive2-lightest'>{t('machines.name-taken')}</span>
					)}
				</div>

				{/* Credentials (catalog images that set up the OS for us) */}
				{requiresCredentials && (
					<div className={`grid gap-4 ${requiresPassword ? 'grid-cols-2' : 'grid-cols-1'}`}>
						<div className='flex flex-col gap-2'>
							<Label htmlFor='vm-username' className='text-13 text-white/60'>
								{t('machines.username')}
							</Label>
							<Input
								id='vm-username'
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								disabled={isCreating}
								maxLength={32}
								autoComplete='off'
							/>
							{username !== '' && !usernameValid && (
								<span className='px-[5px] text-12 -tracking-2 text-destructive2-lightest'>
									{t('machines.windows-username-invalid')}
								</span>
							)}
						</div>
						{requiresPassword && (
							<div className='flex flex-col gap-2'>
								<Label htmlFor='vm-password' className='text-13 text-white/60'>
									{t('machines.password')}
								</Label>
								<Input
									id='vm-password'
									type='password'
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									disabled={isCreating}
									maxLength={128}
									autoComplete='new-password'
								/>
							</div>
						)}
					</div>
				)}

				{requiresLicenseKey && (
					<div className='flex flex-col gap-2'>
						<Label htmlFor='vm-license-key' className='text-13 text-white/60'>
							{t('machines.license-key')}
						</Label>
						<Input
							id='vm-license-key'
							value={licenseKey}
							onChange={(event) => setLicenseKey(event.target.value.toUpperCase())}
							disabled={isCreating}
							maxLength={29}
							autoComplete='off'
							placeholder='XXXXX-XXXXX-XXXXX-XXXXX-XXXXX'
						/>
						{licenseKey !== '' && !licenseKeyValid && (
							<span className='px-[5px] text-12 -tracking-2 text-destructive2-lightest'>
								{t('machines.license-key-invalid')}
							</span>
						)}
					</div>
				)}

				{/* Custom images may target either supported guest architecture. */}
				{isCustomSource && (
					<div className='flex flex-col gap-2'>
						<Label className='text-13 text-white/60'>{t('machines.architecture')}</Label>
						<div className='grid grid-cols-2 gap-2'>
							{(['amd64', 'arm64'] as const).map((option) => (
								<button
									key={option}
									type='button'
									disabled={isCreating}
									onClick={() => setArch(option)}
									className={`h-11 rounded-full border text-13 font-medium transition-colors ${
										selectedArch === option
											? 'border-brand bg-brand/20 text-white'
											: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
									}`}
								>
									{option === 'amd64' ? 'AMD64' : 'ARM64'}
									{option === capabilities?.hostArchitecture ? ` · ${t('machines.native')}` : ''}
								</button>
							))}
						</div>
						{softwareEmulated && (
							<div className='rounded-8 border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-13 leading-snug -tracking-2 text-amber-200/90'>
								{t('machines.software-emulation-warning')}
							</div>
						)}
					</div>
				)}

				{isCustomSource && (
					<div className='overflow-hidden rounded-15 border border-white/10 bg-white/4'>
						<button
							type='button'
							className='flex h-12 w-full items-center justify-between px-4 text-13 font-medium text-white/70 transition-colors hover:bg-white/5'
							onClick={() => setAdvancedOpen((open) => !open)}
							disabled={isCreating}
						>
							{t('machines.advanced')}
							<ChevronDown className={`size-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
						</button>
						{advancedOpen && (
							<div className='flex flex-col gap-5 border-t border-white/8 p-4'>
								<div className='flex flex-col gap-2'>
									<Label className='text-13 text-white/60'>{t('machines.virtual-disk-location')}</Label>
									<button
										type='button'
										className='flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-left text-13 text-white/65 transition-colors hover:bg-white/10'
										onClick={() => setDiskBrowserOpen(true)}
										disabled={isCreating}
									>
										<img src='/assets/dock/dock-files.png' alt='' className='size-4 rounded-[4px]' />
										<span className='min-w-0 flex-1 truncate'>
											{diskDirectory ?? t('machines.virtual-disk-location-default')}
										</span>
									</button>
									{diskDirectory && (
										<button
											type='button'
											className='self-start px-2 text-11 text-white/40 hover:text-white/65'
											onClick={() => setDiskDirectory(undefined)}
											disabled={isCreating}
										>
											{t('machines.virtual-disk-location-reset')}
										</button>
									)}
									{diskDirectory && (
										<div className='rounded-8 border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-12 leading-snug text-amber-100/80'>
											{t('machines.external-install-warning')}
										</div>
									)}
								</div>

								<div className='flex flex-col gap-2'>
									<Label className='text-13 text-white/60'>{t('machines.firmware')}</Label>
									<div className='grid grid-cols-2 gap-2'>
										{(['uefi', 'bios'] as const).map((option) => (
											<button
												key={option}
												type='button'
												disabled={isCreating || (selectedArch === 'arm64' && option === 'bios')}
												onClick={() => setFirmware(option)}
												className={`h-10 rounded-full border text-13 font-medium uppercase transition-colors disabled:opacity-35 ${
													(selectedArch === 'arm64' ? 'uefi' : firmware) === option
														? 'border-brand bg-brand/20 text-white'
														: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
												}`}
											>
												{option}
											</button>
										))}
									</div>
								</div>

								<div className='flex flex-col gap-2'>
									<Label className='text-13 text-white/60'>{t('machines.disk-compatibility')}</Label>
									<div className='grid grid-cols-2 gap-2'>
										{(['virtio', 'sata'] as const).map((option) => (
											<button
												key={option}
												type='button'
												disabled={isCreating || (selectedArch === 'arm64' && option === 'sata')}
												onClick={() => setDiskBus(option)}
												className={`h-10 rounded-full border text-13 font-medium uppercase transition-colors disabled:opacity-35 ${
													(selectedArch === 'arm64' ? 'virtio' : diskBus) === option
														? 'border-brand bg-brand/20 text-white'
														: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
												}`}
											>
												{option}
											</button>
										))}
									</div>
									<p className='text-11 leading-relaxed text-white/35'>
										{t('machines.disk-compatibility-description')}
									</p>
								</div>
							</div>
						)}
						{diskBrowserOpen && (
							<Suspense>
								<MiniBrowser
									open={diskBrowserOpen}
									onOpenChange={setDiskBrowserOpen}
									rootPath='/External'
									rootPaths={['/External', '/Network']}
									preselectOnOpen={false}
									selectionMode='folders'
									selectableFilter={(entry) => {
										if (entry.type !== 'directory') return false
										const segments = entry.path.split('/').filter(Boolean)
										return (
											(segments[0] === 'External' && segments.length >= 2) ||
											(segments[0] === 'Network' && segments.length >= 3)
										)
									}}
									allowNewFolderCreation
									onSelect={setDiskDirectory}
									title={t('machines.virtual-disk-location-select')}
									selectButtonLabel={t('machines.virtual-disk-location-use')}
								/>
							</Suspense>
						)}
					</div>
				)}

				{/* Disk size + cores */}
				<div className='grid grid-cols-2 gap-4'>
					<div className='flex flex-col gap-2'>
						<Label htmlFor='vm-disk' className='text-13 text-white/60'>
							{t('machines.disk-size')}
						</Label>
						<div className='relative'>
							<Input
								id='vm-disk'
								type='number'
								inputMode='numeric'
								min={1}
								max={MAX_DISK_SIZE_GB}
								value={diskSizeInput}
								onChange={(e) => handleDiskChange(e.target.value)}
								disabled={isCreating}
								className='pr-12'
							/>
							<span className='absolute top-1/2 right-4 -translate-y-1/2 text-13 text-white/40'>GB</span>
						</div>
					</div>
					<div className='flex flex-col gap-2'>
						<Label className='text-13 text-white/60'>{t('machines.cores')}</Label>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									className='flex h-12 items-center justify-between rounded-full border-hpx border-white/10 bg-white/6 px-5 text-14 -tracking-2 text-white transition-colors hover:bg-white/10 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/20'
									disabled={isCreating}
								>
									{t('machines.cores-count', {count: cores})}
									<ChevronDown className='size-4 opacity-50' />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align='start' className='w-(--radix-dropdown-menu-trigger-width)'>
								{coreOptions(threads || DEFAULT_CORES).map((option) => (
									<DropdownMenuItem key={option} onSelect={() => setCores(option)}>
										{t('machines.cores-count', {count: option})}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{/* Memory */}
				<div className='flex flex-col gap-2'>
					<div className='flex items-baseline justify-between'>
						<Label className='text-13 text-white/60'>{t('machines.memory')}</Label>
						<span className='text-13 -tracking-2 text-white tabular-nums'>
							{t('machines.gb', {value: fixedMemoryGb ?? memoryGb})}
						</span>
					</div>
					{fixedMemoryGb ? (
						<div className='flex h-12 items-center rounded-full border-hpx border-white/10 bg-white/6 px-5 text-13 text-white/50'>
							{t('machines.memory-fixed-for-os', {value: fixedMemoryGb, os: sourceName})}
						</div>
					) : (
						<div className='flex h-12 items-center gap-4 rounded-full border-hpx border-white/10 bg-white/6 px-5'>
							<span className='shrink-0 text-11 -tracking-2 text-white/30 tabular-nums'>
								{t('machines.gb', {value: MIN_MEMORY_GB})}
							</span>
							<Slider
								value={[memoryGb]}
								min={MIN_MEMORY_GB}
								max={maxMemoryGb ?? DEFAULT_MEMORY_GB}
								step={1}
								onValueChange={([value]) => setMemoryGb(value)}
								disabled={isCreating || maxMemoryGb === undefined}
								aria-label={t('machines.memory')}
							/>
							<span className='shrink-0 text-11 -tracking-2 text-white/30 tabular-nums'>
								{t('machines.gb', {value: maxMemoryGb ?? DEFAULT_MEMORY_GB})}
							</span>
						</div>
					)}
				</div>

				{/* Actions */}
				<div className='mt-2 flex items-center justify-center gap-2'>
					<Button variant='primary' size='lg' onClick={handleCreate} disabled={!canCreate}>
						{isCreating ? t('machines.creating') : t('machines.create-virtual-machine')}
					</Button>
					<Button size='lg' onClick={() => navigate(-1)} disabled={isCreating}>
						{t('cancel')}
					</Button>
				</div>
			</div>
		</motion.div>
	)
}
