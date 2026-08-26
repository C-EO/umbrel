import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import {FileSystemItem} from '@/features/files/types'

export type ViewerMode = 'preview' | 'open' | null
type ActiveViewerMode = Exclude<ViewerMode, null>
type ViewerNavigationGuard = (item: FileSystemItem, mode: ActiveViewerMode) => boolean

export interface FileViewerSlice {
	viewerItem: FileSystemItem | null
	viewerMode: ViewerMode
	viewerNavigationGuard: ViewerNavigationGuard | null
	setViewerItem: (item: FileSystemItem | null, mode?: ViewerMode) => boolean
	setViewerNavigationGuard: (guard: ViewerNavigationGuard | null) => void
}

export const createFileViewerSlice: StateCreator<
	FileViewerSlice & SelectionSlice & ClipboardSlice & NewFolderSlice & DragAndDropSlice,
	[],
	[],
	FileViewerSlice
> = (set, get) => ({
	viewerItem: null,
	viewerMode: null,
	viewerNavigationGuard: null,
	setViewerItem: (item, mode) => {
		const {viewerItem, viewerNavigationGuard} = get()
		const nextMode = mode ?? 'open'
		if (
			item &&
			viewerItem &&
			item.path !== viewerItem.path &&
			viewerNavigationGuard &&
			!viewerNavigationGuard(item, nextMode)
		) {
			return false
		}

		set({viewerItem: item, viewerMode: item ? nextMode : null})
		return true
	},
	setViewerNavigationGuard: (guard) => set({viewerNavigationGuard: guard}),
})
