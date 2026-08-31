import {useLocation, useParams} from 'react-router-dom'

import {isCollectionSection, sectionPath} from '@/features/photos/constants'

// What kind of page the actions bar is on, from the route: a collection
// (albums/people/locations), Sources, or a grid — and among grids, a
// timeline (everything but Deleted)
export function useBarRoute() {
	const route = useParams().section
	const collection = isCollectionSection(route) ? route : undefined
	// Sources is its own route (no :section param), so it's told apart by path
	const isSources = useLocation().pathname === sectionPath('sources')
	const inDeleted = route === 'deleted'
	const hasGrid = collection === undefined && !isSources
	return {collection, isSources, inDeleted, hasGrid, isTimeline: hasGrid && !inDeleted}
}
