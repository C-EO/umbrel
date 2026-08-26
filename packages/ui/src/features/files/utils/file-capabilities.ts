import type {FileSystemItem} from '@/features/files/types'

type FileOperation = FileSystemItem['operations'][number]

// A newly committed folder briefly exists only in the optimistic listing. Keep
// its provisional capabilities narrow; every authoritative empty operations
// array remains deny-by-default.
const OPTIMISTIC_FOLDER_OPERATIONS = new Set<FileOperation>(['move', 'rename', 'writable'])

export function canPerformFileOperation(item: FileSystemItem, operation: FileOperation) {
	if (item.operations.includes(operation)) return true
	if (!item.capabilitiesPending || item.type !== 'directory') return false
	if ('isNew' in item && item.isNew) return false
	return OPTIMISTIC_FOLDER_OPERATIONS.has(operation)
}
