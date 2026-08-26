import {DragEndEvent, DragStartEvent} from '@dnd-kit/core'

import {SYSTEM_MANAGED_ROOT_PATHS, TRASH_PATH} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import {FileSystemItem} from '@/features/files/types'

// An uncommitted "New Folder" placeholder has no file behind it yet, so it can never be
// dragged. A committed-but-not-yet-listed folder has no operations yet — allow it, since
// the move mutation is enforced server-side anyway. Kept in sync with `allowsOperation`
// in the file item, so a draggable item always produces a dragged item to render.
function isMovable(item: FileSystemItem) {
	if ('isNew' in item && item.isNew) return false
	return item.operations.length === 0 || item.operations.includes('move')
}

export function useDragAndDrop() {
	const isReadOnly = useIsFilesReadOnly()
	const selectedItems = useFilesStore((s: FilesStore) => s.selectedItems)
	const setSelectedItems = useFilesStore((s: FilesStore) => s.setSelectedItems)
	const setDraggedItems = useFilesStore((s: FilesStore) => s.setDraggedItems)
	const clearDraggedItems = useFilesStore((s: FilesStore) => s.clearDraggedItems)
	const {moveDraggedItems, trashDraggedItems} = useFilesOperations()

	const handleDragStart = (event: DragStartEvent) => {
		if (isReadOnly) return
		const draggedItem = event.active.data.current as FileSystemItem
		if (!draggedItem || !isMovable(draggedItem)) return

		// if the item is not already selected, reset the selection with the new item
		if (!selectedItems.find((item) => item.path === draggedItem.path)) {
			setSelectedItems([draggedItem])
			setDraggedItems([draggedItem])
		} else {
			// if the item is already selected, use all selected items for dragging
			const movableItems = selectedItems.filter(isMovable)
			if (movableItems.length === 0) return
			setDraggedItems(movableItems)
		}
	}

	const handleDragEnd = async (event: DragEndEvent) => {
		if (isReadOnly) return
		const {over, active} = event
		const targetPath = over?.data.current?.path as string
		if (!targetPath) {
			clearDraggedItems()
			return // dropped outside a valid drop target
		}

		// Drop targets for /Apps and /Machines are disabled, but guard here too so
		// no drop surface can move items into a system-managed root
		if (SYSTEM_MANAGED_ROOT_PATHS.has(targetPath)) {
			clearDraggedItems()
			return
		}

		// if the target is the trash, move the selected items to the trash
		if (targetPath === TRASH_PATH) {
			await trashDraggedItems()
			clearDraggedItems()
		} else {
			// Skip if the item is already in the target directory (e.g. dropped on
			// the listing background or on a sibling file instead of a folder)
			const draggedItem = active.data.current as FileSystemItem | undefined
			if (draggedItem && draggedItem.path.substring(0, draggedItem.path.lastIndexOf('/')) === targetPath) {
				clearDraggedItems()
				return
			}

			await moveDraggedItems({toDirectory: targetPath})
		}

		// no need to clear dragged items after drop
		// as the above mutations will auto-clear it
	}

	return {
		handleDragStart,
		handleDragEnd,
	}
}
