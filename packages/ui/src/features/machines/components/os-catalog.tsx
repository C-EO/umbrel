import {ChevronDown, Upload} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {lazy, Suspense, useEffect, useRef, useState} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Progress} from '@/components/ui/progress'
import {toast} from '@/components/ui/toast'
import type {FileSystemItem} from '@/features/files/types'
import {MachinesTooltip} from '@/features/machines/components/machines-tooltip'
import {OsIcon, OsIconGlow} from '@/features/machines/components/os-icon'
import {layoutMorphTransition, MACHINES_CONFIGURE_PATH} from '@/features/machines/constants'
import {useOsImages} from '@/features/machines/hooks/use-machines'
import type {OsImage} from '@/features/machines/types'
import {prettyMb} from '@/features/machines/utils'
import {useGlobalFiles} from '@/providers/global-files'
import {t} from '@/utils/i18n'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((m) => ({default: m.MiniBrowser})),
)

// Custom disks are restricted to raw images until structured formats can be
// converted in a sandbox that cannot follow references into the host filesystem.
const DISK_IMAGE_ACCEPT = '.iso,.img'
const isDiskImagePath = (path: string) => /\.(iso|img)$/i.test(path)

type CatalogImage = OsImage

// An OS in the catalog: one card per family, potentially several
// downloadable variants (e.g. Ubuntu Desktop / Ubuntu Server)
type OsFamily = {
	key: string
	familyId: string
	name: string
	version: string
	platform: 'linux' | 'windows'
	images: CatalogImage[]
}

function groupOsImages(osImages: CatalogImage[]): OsFamily[] {
	const families: OsFamily[] = []
	const byKey = new Map<string, OsFamily>()
	for (const image of osImages) {
		const key = image.familyId
		let family = byKey.get(key)
		if (!family) {
			family = {
				key,
				familyId: image.familyId,
				name: image.name,
				version: image.version,
				platform: image.platform!,
				images: [],
			}
			byKey.set(key, family)
			families.push(family)
		}
		family.images.push(image)
	}
	return families
}

// Pure OS picker: select a catalog entry or provide a local image, then move
// directly to machine settings. Download/cache state stays internal to create.
// Doubles as the first-time UX (when no machines exist) and the "+" add page.
export default function OsCatalog() {
	const {osImages, isLoading} = useOsImages()
	const families = groupOsImages(osImages)
	const linuxFamilies = families.filter((family) => family.platform === 'linux')
	const windowsFamilies = families.filter((family) => family.platform === 'windows')

	return (
		<div className='flex flex-col gap-8 p-6 md:p-12'>
			{isLoading ? (
				<>
					{/* Placeholder groups mirror the real Linux and Windows card counts so the
					    catalog reserves its full height and nothing below shifts when data arrives */}
					<SkeletonCatalogGroup count={5} />
					<SkeletonCatalogGroup count={5} />
				</>
			) : (
				<>
					<CatalogGroup title={t('machines.catalog-linux')} families={linuxFamilies} />
					<CatalogGroup title={t('machines.catalog-windows')} families={windowsFamilies} />
				</>
			)}

			{/* layout: glide down/up when the custom-image grid above appears or empties */}
			<motion.div
				layout='position'
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				transition={{delay: 0.1, duration: 0.2, ...layoutMorphTransition}}
				className='flex flex-col gap-6'
			>
				<div className='h-px w-full shrink-0 bg-white/6' />
				<IsoSources />
			</motion.div>
		</div>
	)
}

function CatalogGroup({title, families}: {title: string; families: OsFamily[]}) {
	if (families.length === 0) return null
	return (
		<section className='flex flex-col gap-3'>
			<h2 className='text-17 font-semibold -tracking-2 text-white/85'>{title}</h2>
			<OsCardGrid families={families} />
		</section>
	)
}

// Loading placeholder for a catalog group. Mirrors CatalogGroup's structure exactly
// (same section gap, header text metrics, grid, and card box) so it occupies the same
// height as the real group — swapping one for the other can't shift the layout.
function SkeletonCatalogGroup({count}: {count: number}) {
	return (
		<section className='flex flex-col gap-3'>
			{/* Same text-17 strut as the real <h2>, so the header row is exactly as tall */}
			<div className='text-17 font-semibold -tracking-2'>
				<span className='umbrel-pulse inline-block h-[0.7em] w-20 rounded-full bg-white/8 align-middle' />
			</div>
			<div className='grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
				{Array.from({length: count}).map((_, i) => (
					<SkeletonOsCard key={i} />
				))}
			</div>
		</section>
	)
}

// A plain pulsing rounded rectangle. It still nests OsCard's exact internal
// structure — invisible — purely to derive the same height at every breakpoint,
// so swapping in the real card can't shift the layout.
function SkeletonOsCard() {
	return (
		<div className='umbrel-pulse flex flex-col items-center gap-4 rounded-20 border border-white/10 bg-white/6 p-4 pt-6 md:p-6'>
			<div aria-hidden className='invisible flex flex-col items-center gap-2.5'>
				<div className='size-12' />
				<div className='flex flex-col items-center gap-1'>
					<div className='text-15'>&nbsp;</div>
					<div className='text-13'>&nbsp;</div>
					<div className='text-11'>&nbsp;</div>
				</div>
			</div>
			<div aria-hidden className='invisible h-[30px]' />
		</div>
	)
}

function OsCardGrid({families}: {families: OsFamily[]}) {
	return (
		<div className='grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
			<AnimatePresence mode='popLayout' initial={true}>
				{families.map((family, i) => (
					<OsCard key={family.key} family={family} index={i} />
				))}
			</AnimatePresence>
		</div>
	)
}

function OsCard({family, index}: {family: OsFamily; index: number}) {
	return (
		<motion.div
			// Cards glide to their new grid spot when a sibling appears/disappears
			layout='position'
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}
			transition={{delay: index * 0.02, duration: 0.2, ease: 'easeOut', ...layoutMorphTransition}}
			className='relative flex flex-col items-center gap-4 overflow-hidden rounded-20 border border-white/10 bg-white/6 p-4 pt-6 transition-colors duration-300 hover:border-white/15 hover:bg-white/8 md:p-6'
		>
			<OsIconGlow osId={family.familyId} className='top-5 left-1/2 size-12 -translate-x-1/2' />
			<div className='flex flex-col items-center gap-2.5'>
				<OsIcon osId={family.familyId} className='size-12' />
				<div className='flex flex-col items-center gap-1 text-center'>
					<div className='text-15 font-medium -tracking-2 text-white'>{family.name}</div>
					<div className='text-13 -tracking-2 text-white/40'>{family.version}</div>
				</div>
			</div>
			<OsCardAction family={family} />
		</motion.div>
	)
}

const variantHint = (variantName?: string) => {
	if (variantName === 'Desktop') return t('machines.variant-gui')
	if (variantName === 'Server') return t('machines.variant-cli')
	return undefined
}

function OsCardAction({family}: {family: OsFamily}) {
	const navigate = useNavigate()
	const goToConfigure = (osId: string) => navigate(`${MACHINES_CONFIGURE_PATH}?os=${osId}`)

	// Single-build OSs get plain buttons
	if (family.images.length === 1) {
		const image = family.images[0]
		return (
			<Button size='md' className='whitespace-nowrap' onClick={() => goToConfigure(image.id)}>
				{t('machines.install')}
			</Button>
		)
	}

	// Multiple variants (e.g. Desktop / Server): the button opens a picker.
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='md' className='group whitespace-nowrap'>
					{t('machines.install')}
					<ChevronDown className='-mr-1 size-3.5 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='center' className='w-56'>
				{family.images.map((image) => (
					<DropdownMenuItem key={image.id} className='gap-3' onSelect={() => goToConfigure(image.id)}>
						<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
							<span>{image.variantName ?? image.name}</span>
							{variantHint(image.variantName) && (
								<span className='text-11 -tracking-2 text-white/40'>{variantHint(image.variantName)}</span>
							)}
						</div>
						<span className='shrink-0 text-11 -tracking-2 text-white/40 tabular-nums'>
							{prettyMb(image.estimatedInstalledSizeMb ?? image.sizeMb)}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// === Custom image sources: upload or browse in Files ===

function IsoSources() {
	return (
		<div className='flex flex-col gap-3'>
			<div className='flex flex-col gap-1'>
				<h2 className='text-17 font-semibold -tracking-2 text-white/85'>{t('machines.custom-image-title')}</h2>
				<p className='text-12 leading-relaxed text-white/40'>{t('machines.custom-image-formats')}</p>
			</div>
			<div className='flex flex-col gap-4 md:flex-row md:items-stretch md:gap-5'>
				<UploadIsoSource />
				<div className='hidden w-px shrink-0 bg-white/6 md:block' />
				<BrowseIsoSource />
			</div>
		</div>
	)
}

function IsoSourceSection({title, children}: {title: string; children: React.ReactNode}) {
	return (
		<div className='flex flex-1 flex-col gap-3 md:py-2'>
			<h3 className='text-15 font-semibold -tracking-2 text-white/85'>{title}</h3>
			<div className='rounded-12 border border-white/10 bg-white/6 p-2'>{children}</div>
		</div>
	)
}

const isoSourceInnerClass =
	'flex h-[41px] w-full items-center justify-center gap-2 rounded-[7px] border border-[#413c3c] bg-[#232323] px-2.5 text-13 font-medium -tracking-2 text-white/75'

// Real upload via the shared Files uploader: the picked file is uploaded to
// /Home and, once it lands, we proceed to the create form with its path.
function UploadIsoSource() {
	const navigate = useNavigate()
	const {startUpload, uploadingItems, cancelUpload, uploadCompletions} = useGlobalFiles()
	const inputRef = useRef<HTMLInputElement>(null)
	const [upload, setUpload] = useState<{path: string; name: string; startedAt: number} | null>(null)
	// Track that the item has shown up in the uploading list, so its later
	// disappearance can be told apart from it never having been registered
	const hasAppearedRef = useRef(false)
	// Cancel clicked before the uploader registered the item: remember the path
	// and deliver the cancel as soon as it shows up in the list
	const pendingCancelPathRef = useRef<string | null>(null)

	const item = upload ? uploadingItems.find((entry) => entry.path === upload.path) : undefined

	// Deliver a cancel that raced the item's appearance in the uploading list
	useEffect(() => {
		if (!pendingCancelPathRef.current) return
		const entry = uploadingItems.find((entry) => entry.path === pendingCancelPathRef.current)
		if (entry?.tempId) {
			pendingCancelPathRef.current = null
			cancelUpload(entry.tempId)
		}
	}, [uploadingItems, cancelUpload])

	useEffect(() => {
		if (!upload) return
		// A completion record is the only reliable success signal — on success,
		// cancel and collision-skip alike, the item just leaves `uploadingItems`
		const completion = uploadCompletions.find(
			(entry) => entry.path === upload.path && entry.completedAt >= upload.startedAt,
		)
		if (completion) {
			hasAppearedRef.current = false
			setUpload(null)
			if (completion.collisionStrategy === 'keep-both') {
				// A file with this name already existed and the user kept both: the
				// upload landed under a deduplicated name we don't know, so we can't
				// deep-link the create form — point them at Browse instead
				toast.success(t('machines.upload-complete-keep-both'))
			} else {
				navigate(`${MACHINES_CONFIGURE_PATH}?iso=${encodeURIComponent(upload.path)}`)
			}
			return
		}
		if (item) {
			hasAppearedRef.current = true
			// The provider surfaces its own error toast — reset so the user can retry
			if (item.status === 'error') {
				hasAppearedRef.current = false
				setUpload(null)
			}
			return
		}
		// Item left the list with no completion record → cancelled (possibly from
		// the global uploads island) or collision-skipped: just reset the tile
		if (hasAppearedRef.current) {
			hasAppearedRef.current = false
			setUpload(null)
		}
	}, [upload, item, uploadCompletions, navigate])

	const handleCancel = () => {
		hasAppearedRef.current = false
		if (item?.tempId) cancelUpload(item.tempId)
		else if (upload) pendingCancelPathRef.current = upload.path
		setUpload(null)
	}

	return (
		<IsoSourceSection title={t('machines.upload-iso')}>
			<input
				ref={inputRef}
				type='file'
				accept={DISK_IMAGE_ACCEPT}
				className='hidden'
				onChange={(e) => {
					const selected = e.target.files?.[0]
					e.target.value = ''
					if (!selected) return
					hasAppearedRef.current = false
					pendingCancelPathRef.current = null
					setUpload({path: `/Home/${selected.name}`, name: selected.name, startedAt: Date.now()})
					startUpload([selected], '/Home')
				}}
			/>
			{upload ? (
				<div className={isoSourceInnerClass}>
					<span className='max-w-[40%] truncate'>{upload.name}</span>
					<Progress value={item?.progress ?? 0} className='flex-1' />
					<MachinesTooltip label={t('cancel')}>
						<button
							className='shrink-0 opacity-50 transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-90'
							onClick={handleCancel}
							aria-label={t('cancel')}
						>
							<RiCloseCircleFill className='size-4' />
						</button>
					</MachinesTooltip>
				</div>
			) : (
				<button
					className={`${isoSourceInnerClass} border-dashed transition-colors duration-300 hover:bg-[#2a2a2a]`}
					onClick={() => inputRef.current?.click()}
				>
					<Upload className='size-4 shrink-0' />
					{t('machines.upload-iso-description')}
				</button>
			)}
		</IsoSourceSection>
	)
}

function BrowseIsoSource() {
	const navigate = useNavigate()
	const [browserOpen, setBrowserOpen] = useState(false)

	return (
		<IsoSourceSection title={t('machines.browse-iso')}>
			<button
				className={`${isoSourceInnerClass} border-dashed transition-colors duration-300 hover:bg-[#2a2a2a]`}
				onClick={() => setBrowserOpen(true)}
			>
				<img src='/assets/dock/dock-files.png' alt='' className='size-4 shrink-0 rounded-[4px]' />
				{t('machines.browse-iso-description')}
			</button>
			{browserOpen && (
				<Suspense>
					<MiniBrowser
						open={browserOpen}
						onOpenChange={setBrowserOpen}
						rootPath='/Home'
						preselectOnOpen={false}
						selectionMode='files-and-folders'
						selectableFilter={(entry: FileSystemItem) => isDiskImagePath(entry.path)}
						onSelect={(path) => navigate(`${MACHINES_CONFIGURE_PATH}?iso=${encodeURIComponent(path)}`)}
						title={t('machines.browse-iso-title')}
						selectButtonLabel={t('machines.browse-iso-select')}
					/>
				</Suspense>
			)}
		</IsoSourceSection>
	)
}
