import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {primaryButtonProps} from '@/layouts/bare/shared'
import {trpcReact} from '@/trpc/trpc'

type RaidErrorProps = {
	title: string
	instructions: string
	image?: {
		src: string
		alt: string
	}
}

// Error component for both device detection errors and no SSDs found.
export function RaidError({title, instructions, image}: RaidErrorProps) {
	const {t} = useTranslation()
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		onError: (error) => {
			toast.error(t('shut-down.failed', {message: error.message}), {area: 'umbrelos'})
		},
	})

	const handleShutdown = () => {
		shutdownMut.mutate()
	}

	return (
		<div className={`flex flex-1 flex-col items-center justify-center ${image ? 'md:justify-between' : ''}`}>
			{/* Content */}
			<div className={`flex flex-col items-center gap-4 px-4 ${image ? 'md:pt-8' : ''}`}>
				<h1
					className='text-[18px] font-bold text-white/85 md:text-[20px]'
					style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
				>
					{title}
				</h1>
				<p className='-mt-2 max-w-[300px] text-center text-[14px] text-white/70 md:text-[15px]'>{instructions}</p>
				<button onClick={handleShutdown} disabled={shutdownMut.isPending} {...primaryButtonProps}>
					{shutdownMut.isPending ? t('shut-down.shutting-down') : t('shut-down')}
				</button>
			</div>

			{/* Bottom image (optional, hidden on mobile) */}
			{image && (
				<img
					src={image.src}
					alt={image.alt}
					draggable={false}
					className='hidden w-full max-w-[800px] translate-x-14 object-contain object-bottom md:-mb-6 md:block md:translate-x-20'
					style={{
						aspectRatio: '1693 / 738',
						maskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
						WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
					}}
				/>
			)}
		</div>
	)
}
