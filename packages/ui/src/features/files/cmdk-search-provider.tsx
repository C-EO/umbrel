import {useTranslation} from 'react-i18next'

import {CommandItem} from '@/components/ui/command'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useSearchFiles} from '@/features/files/hooks/use-search-files'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'

// how many max results we want to show in the command-k
const MAX_RESULTS = 10

// Files are searched on the server, so unlike the other command palette sources
// this renders its own rows below the ranked results once they arrive.
export function FilesCmdkSearchProvider({query, close}: {query: string; close: () => void}) {
	const {t} = useTranslation()
	const {navigateToItem} = useNavigate()
	const trimmedQuery = query.trim()

	const {results} = useSearchFiles({query: trimmedQuery, maxResults: MAX_RESULTS, keepPreviousResults: true})

	if (trimmedQuery.length === 0) return null

	return results.map((item) => (
		<CommandItem
			key={item.path}
			value={`file:${item.path}`}
			icon={<FileItemIcon item={item} className='h-full w-full' />}
			onSelect={() => {
				navigateToItem(item)
				close()
			}}
		>
			<span>
				{formatItemName({name: item.name, maxLength: 40})} <span className='opacity-50'>{t('generic-in')} Files</span>
			</span>
		</CommandItem>
	))
}
