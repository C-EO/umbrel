import {useEffect, useState} from 'react'

import {AuthorizedUrlState} from '@/features/files/components/file-viewer/authorized-url-state'
import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

interface PdfViewerProps {
	item: FileSystemItem
}

export default function PdfViewer({item}: PdfViewerProps) {
	const [dimensions, setDimensions] = useState({width: 0, height: 0})
	const encodedPath = encodeURIComponent(item.path)
	const isMobile = useIsMobile()
	const authorizedUrl = useAuthorizedHttpUrlQuery(
		isMobile ? `/api/files/download?path=${encodedPath}` : `/api/files/view?path=${encodedPath}`,
	)

	useEffect(() => {
		if (isMobile && authorizedUrl.status === 'ready') {
			// This runs after the async URL token request, so opening a new tab here
			// is blocked as an unsolicited popup on mobile browsers. A same-tab
			// navigation remains reliable and the browser back action returns to Files.
			window.location.assign(authorizedUrl.url)
			return
		}

		const updateDimensions = () => {
			const width = window.innerWidth - 300
			const height = window.innerHeight - 200

			if (width > 1024) {
				setDimensions({width: 1024, height: 800})
			} else {
				setDimensions({width, height})
			}
		}
		updateDimensions()
		window.addEventListener('resize', updateDimensions)

		return () => window.removeEventListener('resize', updateDimensions)
	}, [authorizedUrl.status, authorizedUrl.url, isMobile])

	return (
		<AuthorizedUrlState query={authorizedUrl}>
			{(url) =>
				isMobile ? null : (
					<ViewerWrapper>
						<iframe
							src={url}
							height='100%'
							width='100%'
							style={{
								width: `${dimensions.width}px`,
								height: `${dimensions.height}px`,
							}}
							className='mx-auto block rounded-lg border-none'
							title={item.name}
						/>
					</ViewerWrapper>
				)
			}
		</AuthorizedUrlState>
	)
}
