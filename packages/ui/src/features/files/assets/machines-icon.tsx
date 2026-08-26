import {SVGProps, useId} from 'react'

// Retro CRT monitor: a chunky body with a bulged screen cut out of it, sitting
// on a pedestal stand.
const BODY =
	'M3.1 0.5H12.9A2.6 2.6 0 0 1 15.5 3.1V9.3A2.6 2.6 0 0 1 12.9 11.9H3.1A2.6 2.6 0 0 1 0.5 9.3V3.1A2.6 2.6 0 0 1 3.1 0.5ZM4.65 2.9C6.66 2.62 9.34 2.62 11.35 2.9C12.362 3.103 12.7 3.575 12.7 4.25C12.98 5.18 12.98 6.42 12.7 7.35C12.7 8.025 12.362 8.497 11.35 8.7C9.34 8.98 6.66 8.98 4.65 8.7C3.637 8.497 3.3 8.025 3.3 7.35C3.02 6.42 3.02 5.18 3.3 4.25C3.3 3.575 3.637 3.103 4.65 2.9Z'

const STAND =
	'M6.5 11.9H9.5V13.15C9.5 13.59 9.61 13.7 10.05 13.7H10.95A0.85 0.85 0 0 1 10.95 15.4H5.05A0.85 0.85 0 0 1 5.05 13.7H5.95C6.39 13.7 6.5 13.59 6.5 13.15Z'

export const MachinesIcon = (props: SVGProps<SVGSVGElement>) => {
	const id = useId()
	return (
		<svg width={16} height={16} viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
			<g filter={`url(#filter-${id})`}>
				<path fillRule='evenodd' clipRule='evenodd' d={BODY} fill='hsl(var(--color-brand))' />
				<path fillRule='evenodd' clipRule='evenodd' d={BODY} fill={`url(#gradient-${id})`} />
				<path d={STAND} fill='hsl(var(--color-brand))' />
				<path d={STAND} fill={`url(#gradient-${id})`} />
			</g>
			<defs>
				<filter
					id={`filter-${id}`}
					x='0.15'
					y='0.15'
					width='15.7'
					height='15.7'
					filterUnits='userSpaceOnUse'
					colorInterpolationFilters='sRGB'
				>
					<feFlood floodOpacity={0} result='BackgroundImageFix' />
					<feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dx='0.32' dy='0.32' />
					<feGaussianBlur stdDeviation='0.08' />
					<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
					<feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0' />
					<feBlend mode='normal' in2='shape' result='innerShadowTop' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dx='-0.32' dy='-0.32' />
					<feGaussianBlur stdDeviation='0.16' />
					<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
					<feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' />
					<feBlend mode='normal' in2='innerShadowTop' result='innerShadowBottom' />
				</filter>
				<linearGradient id={`gradient-${id}`} x1='8' y1='0.5' x2='8' y2='15.4' gradientUnits='userSpaceOnUse'>
					<stop offset='0.315' stopOpacity={0} />
					<stop offset='0.965' stopOpacity={0.48} />
				</linearGradient>
			</defs>
		</svg>
	)
}
