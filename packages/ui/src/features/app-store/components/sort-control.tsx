import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {ChevronDown} from '@/components/chevron-down'
import {Button} from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type {AppSortId} from '@/features/app-store/data/catalog'

/**
 * Sort choice backed by `?sort=` so it survives back-navigation. Unavailable
 * options (e.g. date sorts while offline) are hidden, not disabled; with only
 * one option there is nothing to choose, so nothing renders.
 */
export function useSortParam(availableSorts: AppSortId[]): AppSortId {
	const [searchParams] = useSearchParams()
	const requested = searchParams.get('sort')
	return arrayIncludes(availableSorts, requested) ? requested : 'name'
}

export function SortControl({availableSorts}: {availableSorts: AppSortId[]}) {
	const {t} = useTranslation()
	const [searchParams, setSearchParams] = useSearchParams()
	const sort = useSortParam(availableSorts)

	if (availableSorts.length < 2) return null

	const labels: Record<AppSortId, string> = {
		name: t('app-store.sort.name'),
		newest: t('app-store.sort.newest'),
		'recently-updated': t('app-store.sort.recently-updated'),
	}

	const selectSort = (value: AppSortId) => {
		if (value === 'name') searchParams.delete('sort')
		else searchParams.set('sort', value)
		setSearchParams(searchParams, {replace: true})
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='md' className='group w-auto gap-2' aria-label={t('app-store.sort.label')}>
					{labels[sort]}
					<span className='transition-transform duration-200 group-data-[state=open]:rotate-180'>
						<ChevronDown />
					</span>
				</Button>
			</DropdownMenuTrigger>
			{/* p-1 matches the tight context-menu surface */}
			<DropdownMenuContent className='p-1' align='end'>
				{availableSorts.map((id) => (
					<DropdownMenuCheckboxItem key={id} checked={sort === id} onSelect={() => selectSort(id)}>
						{labels[id]}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
