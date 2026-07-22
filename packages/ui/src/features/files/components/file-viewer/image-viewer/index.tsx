import {AuthorizedUrlState} from '@/features/files/components/file-viewer/authorized-url-state'
import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

interface ImageViewerProps {
	item: FileSystemItem
}

export default function ImageViewer({item}: ImageViewerProps) {
	const previewUrl = useAuthorizedHttpUrlQuery(`/api/files/view?path=${encodeURIComponent(item.path)}`)

	return (
		<AuthorizedUrlState query={previewUrl}>
			{(url) => (
				<ViewerWrapper>
					<img
						src={url}
						alt={item.name}
						className='absolute top-1/2 left-1/2 max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 object-contain md:max-h-[80%] md:max-w-[90%] md:rounded-lg'
					/>
				</ViewerWrapper>
			)}
		</AuthorizedUrlState>
	)
}
