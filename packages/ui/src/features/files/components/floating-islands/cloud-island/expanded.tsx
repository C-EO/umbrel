import {motion} from 'motion/react'
import {useTranslation} from 'react-i18next'

import {ScrollArea} from '@/components/ui/scroll-area'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {useAnimatedNumber} from '@/features/files/hooks/use-animated-number'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'

import {CloudProgressBar} from '../../shared/cloud-progress-bar'
import type {CloudIslandRow} from './index'

const cloudLogo = (provider: string | undefined) => CLOUD_PROVIDER_LOGOS[provider ?? ''] ?? '/assets/cloud/cloud.webp'

const formatSpeed = (bytesPerSecond: number) =>
	bytesPerSecond === 0 ? '0 B/s' : `${formatFilesystemSize(bytesPerSecond)}/s`

// "Downloading from Google Drive" when every transfer shares a provider, the
// generic title when providers are mixed or still unknown
const islandTitle = (t: ReturnType<typeof useTranslation>['t'], rows: CloudIslandRow[]) => {
	const providerNames = [...new Set(rows.map((row) => row.providerName))]
	return providerNames.length === 1 && providerNames[0]
		? t('files-cloud.island-title-provider', {provider: providerNames[0]})
		: t('files-cloud.island-title')
}

export function ExpandedContent({rows, totalSpeed}: {rows: CloudIslandRow[]; totalSpeed: number}) {
	const {t} = useTranslation()

	// A single transfer gets the full ring treatment; multiple show the list
	if (rows.length === 1) {
		return <SingleTransfer row={rows[0]} totalSpeed={totalSpeed} />
	}

	return (
		<div className='flex size-full flex-col overflow-hidden px-6 py-5'>
			<div className='flex items-baseline justify-between'>
				<div className='text-sm tracking-tight text-white/90'>{islandTitle(t, rows)}</div>
				<div className='text-xs text-white/50'>{formatSpeed(totalSpeed)}</div>
			</div>
			<ScrollArea className='mt-3 flex-1'>
				<div className='flex flex-col gap-3 pr-2'>
					{rows.map((row) => (
						<div key={row.id} className='flex items-center gap-2'>
							<img src={cloudLogo(row.provider)} alt='' className='size-6 shrink-0 object-contain' draggable={false} />
							<div className='min-w-0 flex-1'>
								<div className='flex items-center justify-between text-xs text-white/70'>
									<span className='truncate'>{row.name}</span>
									<span className='shrink-0 text-white/60'>
										{row.totalFiles
											? t('files-cloud.island-files', {
													transferred: row.transferredFiles,
													total: row.totalFiles,
												})
											: row.totalBytes
												? t('files-cloud.island-files', {
														transferred: formatFilesystemSize(row.transferredBytes),
														total: formatFilesystemSize(row.totalBytes),
													})
												: formatFilesystemSize(row.transferredBytes)}
									</span>
								</div>
								<CloudProgressBar percent={row.percent} className='mt-1' />
							</div>
						</div>
					))}
				</div>
			</ScrollArea>
		</div>
	)
}

function SingleTransfer({row, totalSpeed}: {row: CloudIslandRow; totalSpeed: number}) {
	const {t} = useTranslation()
	const animatedPercent = useAnimatedNumber(row.percent)

	const radius = 40
	const circumference = 2 * Math.PI * radius
	const strokeDashoffset =
		animatedPercent === undefined
			? circumference
			: circumference - (Math.min(100, animatedPercent) / 100) * circumference

	return (
		<div className='flex size-full items-center justify-between overflow-hidden px-8 py-6'>
			{/* Left side */}
			<div className='flex min-w-0 flex-col gap-1'>
				<div className='truncate text-sm tracking-tight text-white/90'>{islandTitle(t, [row])}</div>
				<div className='truncate text-xs font-normal text-white/50'>{row.name}</div>
				<div className='mt-2 flex items-baseline gap-1'>
					{animatedPercent === undefined ? (
						<div className='text-3xl font-light tracking-tight text-white'>
							{/* formatFilesystemSize renders 0 as "-"; only zero-byte-file runs land here */}
							{row.transferredBytes > 0 ? formatFilesystemSize(row.transferredBytes) : '0 B'}
						</div>
					) : (
						<>
							<div className='text-5xl font-light tracking-tight text-white'>{animatedPercent.toFixed(0)}</div>
							<div className='font-medium text-white/40'>%</div>
						</>
					)}
				</div>
				<div className='text-xs text-white/40'>
					{row.totalFiles
						? `${t('files-cloud.island-files', {transferred: row.transferredFiles, total: row.totalFiles})} · ${formatSpeed(totalSpeed)}`
						: row.totalBytes
							? `${t('files-cloud.island-files', {transferred: formatFilesystemSize(row.transferredBytes), total: formatFilesystemSize(row.totalBytes)})} · ${formatSpeed(totalSpeed)}`
							: formatSpeed(totalSpeed)}
				</div>
			</div>

			{/* Right side */}
			<motion.div
				className='relative flex shrink-0 items-center justify-center'
				initial={{scale: 0.6, opacity: 0, rotate: -10}}
				animate={{scale: 1, opacity: 1, rotate: 0}}
				exit={{scale: 0.6, opacity: 0, rotate: 10}}
				transition={{type: 'spring', stiffness: 300, damping: 20, delay: 0.05}}
			>
				{/* Subtle background glow */}
				<motion.div
					className='absolute inset-0 rounded-full bg-linear-to-br from-brand/30 to-transparent'
					initial={{scale: 0.8, opacity: 0}}
					animate={{scale: 1, opacity: 1}}
					exit={{scale: 0.8, opacity: 0}}
					transition={{type: 'spring', stiffness: 400, damping: 25, delay: 0.1}}
				/>

				{/* Main progress ring */}
				<svg
					className={`relative size-28 -rotate-90 ${animatedPercent === undefined ? 'motion-safe:animate-pulse' : ''}`}
					viewBox='0 0 112 112'
				>
					<defs>
						<linearGradient id='cloudProgressGradient' x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='hsl(var(--color-brand))' />
							<stop offset='100%' stopColor='hsl(var(--color-brand-lightest))' />
						</linearGradient>
						<filter id='cloudGlow'>
							<feGaussianBlur stdDeviation='2' result='coloredBlur' />
							<feMerge>
								<feMergeNode in='coloredBlur' />
								<feMergeNode in='SourceGraphic' />
							</feMerge>
						</filter>
					</defs>
					{/* Background circle */}
					<circle
						cx='56'
						cy='56'
						r={radius}
						stroke='currentColor'
						strokeWidth='3'
						fill='none'
						className='text-white/10'
					/>
					{/* Progress circle with gradient */}
					<circle
						cx='56'
						cy='56'
						r={radius}
						stroke='url(#cloudProgressGradient)'
						strokeWidth='3'
						fill='none'
						strokeDasharray={circumference}
						strokeDashoffset={strokeDashoffset}
						className='transition-all duration-700 ease-out'
						strokeLinecap='round'
						filter='url(#cloudGlow)'
					/>
				</svg>

				{/* Provider logo container */}
				<motion.div
					className='absolute inset-0 flex items-center justify-center'
					initial={{scale: 0.7, opacity: 0}}
					animate={{scale: 1, opacity: 1}}
					exit={{scale: 0.7, opacity: 0}}
					transition={{type: 'spring', stiffness: 350, damping: 22, delay: 0.2}}
				>
					<motion.div
						className='relative rounded-full border border-white/10 bg-white/5 p-3'
						initial={{scale: 0.8, opacity: 0}}
						animate={{scale: 1, opacity: 1}}
						exit={{scale: 0.8, opacity: 0}}
						transition={{type: 'spring', stiffness: 400, damping: 20, delay: 0.25}}
					>
						<img src={cloudLogo(row.provider)} alt='' className='size-12 object-contain p-1' draggable={false} />
					</motion.div>
				</motion.div>
			</motion.div>
		</div>
	)
}
