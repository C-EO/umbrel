import {ChevronRight, TriangleAlert, X} from 'lucide-react'

import {CloudIcon} from '@/features/files/assets/cloud-icon'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'

// A small cloud → umbrelOS diagram with a troubled connection: a cross for
// confirmations where continuing severs a cloud, an amber alert where
// the link needs the user to act. Rendered inside an AlertDialogDescription
// (a <p>), so it uses only phrasing-content elements.
export function CloudBreakDiagram({provider, glyph = 'cross'}: {provider?: string; glyph?: 'cross' | 'alert'}) {
	const logo = provider ? CLOUD_PROVIDER_LOGOS[provider] : undefined

	return (
		<span className='mt-4 mb-3 flex items-center justify-center gap-3'>
			{/* Cloud side */}
			{logo ? (
				<img src={logo} alt='' className='size-11 shrink-0 object-contain' draggable={false} />
			) : (
				<CloudIcon className='size-11 shrink-0' />
			)}

			{/* Troubled connection: cloud flows toward the Umbrel, interrupted */}
			<span className='relative flex h-8 w-20 items-center'>
				<span className='h-px w-full bg-linear-to-r from-white/5 via-white/25 to-white/5' />
				<ChevronRight className='absolute -right-1 size-3 text-white/30' />
				<span className='absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-dialog-content'>
					{glyph === 'alert' ? (
						<TriangleAlert className='size-3 text-yellow-400' strokeWidth={2.5} />
					) : (
						<X className='size-3 text-white' strokeWidth={3} />
					)}
				</span>
			</span>

			{/* Umbrel side */}
			<img
				src='/assets/umbrel-ios.png'
				alt='umbrelOS'
				className='size-11 shrink-0 rounded-xl object-contain'
				draggable={false}
			/>
		</span>
	)
}
