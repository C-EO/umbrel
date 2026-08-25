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
			<source
				media='(min-width: 1200px)'
				src='/assets/onboarding/wallpaper-23-large.mp4'
				type='video/mp4; codecs="avc1.640033"'
			/>
			<source src='/assets/onboarding/wallpaper-23-medium.webm' type='video/webm; codecs="vp9"' />
			<source src='/assets/onboarding/wallpaper-23-medium.mp4' type='video/mp4; codecs="avc1.640029"' />
		</video>
	)
}
