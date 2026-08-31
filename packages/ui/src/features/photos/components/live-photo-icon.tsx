import type {ComponentProps} from 'react'

// The Live Photo mark: a filled centre, a ring around it, and an outer ring
// of short dashes — the badge iPhones put on a live photo, drawn here so the
// grid, the sidebar and the search chips all say "Live" the same way.
//
// The dashes are one stroked circle, not two dozen nodes: every live tile in
// the grid mounts this, so the whole mark costs three elements. `strokeWidth`
// is set per shape rather than inherited, so the proportions hold whatever
// the surrounding icon set asks for. The dash period is the circle's
// circumference over 24 (2π × 9.8 / 24 = 2.566), which lands the last dash
// flush against the first.
export function LivePhotoIcon(props: ComponentProps<'svg'>) {
	return (
		<svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true' {...props}>
			<circle cx='12' cy='12' r='3' fill='currentColor' />
			<circle cx='12' cy='12' r='6' stroke='currentColor' strokeWidth='1.5' />
			<circle
				cx='12'
				cy='12'
				r='9.8'
				stroke='currentColor'
				strokeWidth='1.4'
				strokeLinecap='round'
				strokeDasharray='0.5 2.066'
			/>
		</svg>
	)
}
