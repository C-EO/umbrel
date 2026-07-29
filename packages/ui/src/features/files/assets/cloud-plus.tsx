import {SVGProps} from 'react'

// A cloud with a plus, drawn in the lucide outline style so it sits naturally
// next to the other action bar icons (lucide ships no CloudPlus)
export const CloudPlusIcon = (props: SVGProps<SVGSVGElement>) => (
	<svg
		width='24'
		height='24'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		xmlns='http://www.w3.org/2000/svg'
		{...props}
	>
		<path d='M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' />
		<path d='M12 10v6' />
		<path d='M9 13h6' />
	</svg>
)
