import {useSyncExternalStore} from 'react'

function subscribe(onChange: () => void) {
	document.addEventListener('visibilitychange', onChange)
	return () => document.removeEventListener('visibilitychange', onChange)
}

const getSnapshot = () => document.visibilityState === 'hidden'
const getServerSnapshot = () => false

/** Whether the page is hidden from the user (background tab, minimized window). */
export function useDocumentHidden() {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
