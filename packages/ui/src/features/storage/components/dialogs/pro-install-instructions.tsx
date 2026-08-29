// Umbrel Pro SSD installation guidance: the photo does the teaching, with prose
// filling in the physical steps. Shared by the install and swap dialogs.
import {useTranslation} from 'react-i18next'

export function ProInstallInstructions({paragraphs}: {paragraphs: string[]}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col gap-4'>
			<img
				src='/assets/storage/install-ssd-instruction.webp'
				alt={t('storage-manager.install-ssd.image-alt')}
				className='w-full rounded-8'
				draggable={false}
				style={{
					aspectRatio: '1646 / 1186',
					maskImage:
						'linear-gradient(to right, transparent 0%, black 15%), linear-gradient(to bottom, black 85%, transparent 100%)',
					maskComposite: 'intersect',
					WebkitMaskImage:
						'linear-gradient(to right, transparent 0%, black 15%), linear-gradient(to bottom, black 85%, transparent 100%)',
					WebkitMaskComposite: 'source-in',
				}}
			/>
			{paragraphs.map((paragraph, index) => (
				<p key={index} className='text-13 leading-relaxed text-white/60'>
					{paragraph}
				</p>
			))}
		</div>
	)
}
