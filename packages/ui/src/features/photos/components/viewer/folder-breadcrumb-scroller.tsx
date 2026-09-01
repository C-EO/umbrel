import {useLayoutEffect, useRef} from 'react'

import {FadeScroller} from '@/components/fade-scroller'
import {DestinationBreadcrumbs} from '@/features/files/components/dialogs/cloud-add-dialog/destination-step'

// Keep the current folder in view when the path first appears (and when the
// viewer steps to an item in another folder). The rest of the path remains
// available by scrolling back through the faded leading edge.
export function FolderBreadcrumbScroller({path, homePath}: {path: string; homePath: string}) {
	const scrollerRef = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const scroller = scrollerRef.current
		if (scroller) scroller.scrollLeft = scroller.scrollWidth
	}, [path])

	return (
		<FadeScroller
			direction='x'
			ref={scrollerRef}
			className='umbrel-hide-scrollbar min-w-0 overflow-x-auto whitespace-nowrap'
		>
			<div className='w-max min-w-full'>
				<DestinationBreadcrumbs path={path} homePath={homePath} />
			</div>
		</FadeScroller>
	)
}
