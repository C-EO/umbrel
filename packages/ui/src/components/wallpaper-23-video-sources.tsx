// Shared by onboarding and the selected wallpaper. Let the browser exhaust this
// ordered list: Safari may reject WebM candidates before successfully loading H.264.
export function Wallpaper23VideoSources() {
	return (
		<>
			<source
				media='(min-width: 1200px)'
				src='/assets/onboarding/wallpaper-23-large-av1.webm'
				type='video/webm; codecs="av01.0.12M.08"'
			/>
			<source
				media='(min-width: 1200px)'
				src='/assets/onboarding/wallpaper-23-large-vp9.webm'
				type='video/webm; codecs="vp9"'
			/>
			<source
				media='(min-width: 1200px)'
				src='/assets/onboarding/wallpaper-23-large.mp4'
				type='video/mp4; codecs="avc1.640033"'
			/>
			<source src='/assets/onboarding/wallpaper-23-medium-av1.webm' type='video/webm; codecs="av01.0.08M.08"' />
			<source src='/assets/onboarding/wallpaper-23-medium-vp9.webm' type='video/webm; codecs="vp9"' />
			<source src='/assets/onboarding/wallpaper-23-medium.mp4' type='video/mp4; codecs="avc1.640029"' />
		</>
	)
}
