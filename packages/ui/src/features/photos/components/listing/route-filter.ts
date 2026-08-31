import {useMemo} from 'react'
import {useParams} from 'react-router-dom'

import {usePhotosView, type SearchFilter} from '@/features/photos/components/view-context'
import {isFilterSection, SECTION_FILTERS} from '@/features/photos/constants'
import type {ItemFilter} from '@/features/photos/hooks/use-items'

type RouteParameters = {
	section?: string
	sourceId?: string
	albumId?: string
}

export function composeRouteFilter(
	{section, sourceId, albumId}: RouteParameters,
	searchFilter: SearchFilter,
): ItemFilter {
	const fixed: ItemFilter = {
		...(isFilterSection(section) ? SECTION_FILTERS[section] : {}),
		...(sourceId ? {sourceIds: [sourceId]} : {}),
		...(albumId ? {albumIds: [albumId]} : {}),
	}
	// Search may add orthogonal constraints, but the route remains authoritative
	// for any dimension it fixes. This also prevents stale or undefined search
	// fields from broadening a section, source, or album while navigation settles.
	return {...searchFilter, ...fixed}
}

export function useRouteFilter(): ItemFilter {
	const parameters = useParams()
	const {search} = usePhotosView()
	return useMemo(
		() => composeRouteFilter(parameters, search.filter),
		[parameters.section, parameters.sourceId, parameters.albumId, search.filter],
	)
}
