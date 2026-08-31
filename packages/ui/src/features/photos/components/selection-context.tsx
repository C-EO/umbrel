import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {BASE_ROUTE_PATH} from '@/features/photos/constants'

type PhotosSelection = {
	// The selected items. A new set on every change, so a consumer can compare
	// by identity; never mutated.
	ids: ReadonlySet<string>
	// Selection mode: something is selected, or the user entered it themselves
	// (the Select button) and hasn't pressed Done. Tiles show their circles,
	// a click toggles instead of opening, and the actions bar shows the
	// selection's actions.
	selecting: boolean
	// Enter selection mode with nothing selected yet
	start: () => void
	// Leave it, dropping the selection
	done: () => void
	toggle: (id: string) => void
	// Replace the selection
	set: (ids: Iterable<string>) => void
	// Drop what is no longer in the list
	retain: (known: ReadonlySet<string>) => void
	// The album items are being picked for, while they are: selection mode
	// that follows the user from view to view — the library, Videos, a
	// person, another album — gathering one selection for the album, until
	// it is added (or picking is cancelled) with `done`. Picking starts in
	// the whole library.
	pickingFor: string | undefined
	pickFor: (albumId: string) => void
}

const EMPTY: ReadonlySet<string> = new Set()
const PhotosSelectionContext = createContext<PhotosSelection | undefined>(undefined)

// Which items are selected, shared between the listing (where they are
// picked) and the actions bar (which acts on them). Its own context, apart
// from the view state: selection changes on every click and marquee frame,
// and only these two need to hear about it.
//
// Mode is derived, not stored: it holds as long as anything is selected, so
// on desktop unchecking the last item leaves it, while the Select button
// (touch, where nothing can be hovered) holds it open until Done.
export function PhotosSelectionProvider({children}: {children: ReactNode}) {
	const [ids, setIds] = useState(EMPTY)
	const [explicit, setExplicit] = useState(false)
	const [pickingFor, setPickingFor] = useState<string>()

	// A new route is a new list: nothing from the old one stays selected —
	// unless the selection is being gathered for an album, when it is the
	// point that it carries across
	const {pathname} = useLocation()
	const navigate = useNavigate()
	useEffect(() => {
		if (pickingFor) return
		setIds(EMPTY)
		setExplicit(false)
	}, [pathname, pickingFor])

	const start = useCallback(() => setExplicit(true), [])
	const done = useCallback(() => {
		setIds(EMPTY)
		setExplicit(false)
		setPickingFor(undefined)
	}, [])
	const pickFor = useCallback(
		(albumId: string) => {
			setIds(EMPTY)
			setPickingFor(albumId)
			navigate(BASE_ROUTE_PATH)
		},
		[navigate],
	)
	const toggle = useCallback(
		(id: string) =>
			setIds((prev) => {
				const next = new Set(prev)
				if (!next.delete(id)) next.add(id)
				return next
			}),
		[],
	)
	const set = useCallback((next: Iterable<string>) => setIds(new Set(next)), [])
	const retain = useCallback(
		(known: ReadonlySet<string>) =>
			setIds((prev) => {
				if (prev.size === 0) return prev
				const next = new Set([...prev].filter((id) => known.has(id)))
				return next.size === prev.size ? prev : next
			}),
		[],
	)

	const value = useMemo<PhotosSelection>(
		() => ({
			ids,
			selecting: explicit || ids.size > 0 || pickingFor !== undefined,
			start,
			done,
			toggle,
			set,
			retain,
			pickingFor,
			pickFor,
		}),
		[ids, explicit, start, done, toggle, set, retain, pickingFor, pickFor],
	)
	return <PhotosSelectionContext value={value}>{children}</PhotosSelectionContext>
}

export function usePhotosSelection() {
	const ctx = useContext(PhotosSelectionContext)
	if (!ctx) throw new Error('usePhotosSelection must be used within <PhotosSelectionProvider />')
	return ctx
}
