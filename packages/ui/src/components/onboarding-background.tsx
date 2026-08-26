import {Wallpaper23VideoSources} from '@/components/wallpaper-23-video-sources'
import {cn} from '@/lib/utils'

const backgroundClass = 'pointer-events-none fixed inset-0 size-full object-cover object-center'

export function OnboardingBackground({className}: {className?: string}) {
	return (
		<video
			autoPlay
			loop
			muted
			playsInline
			poster='/assets/wallpapers/23.jpg'
			className={cn(backgroundClass, className)}
		>
			<Wallpaper23VideoSources />
		</video>
	)
}
