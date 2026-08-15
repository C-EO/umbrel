import {useCallback, useSyncExternalStore} from 'react'

const AUDIO_PREFERENCE_EVENT = 'umbrel:machine-audio-preference'
const memoryPreferences = new Map<string, boolean>()

const preferenceKey = (machineId: string) => `umbrel:machine:${machineId}:audio-muted`

function readPreference(machineId: string) {
	try {
		const storedPreference = localStorage.getItem(preferenceKey(machineId))
		if (storedPreference !== null) return storedPreference === 'true'
	} catch {
		// Fall back to memory when storage is unavailable (for example, strict
		// private-browsing modes).
	}
	return memoryPreferences.get(machineId) ?? false
}

export function useMachineAudioPreference(machineId: string) {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const key = preferenceKey(machineId)
			const onStorage = (event: StorageEvent) => {
				if (event.key === key) onChange()
			}
			const onLocalChange = (event: Event) => {
				if ((event as CustomEvent<string>).detail === machineId) onChange()
			}
			window.addEventListener('storage', onStorage)
			window.addEventListener(AUDIO_PREFERENCE_EVENT, onLocalChange)
			return () => {
				window.removeEventListener('storage', onStorage)
				window.removeEventListener(AUDIO_PREFERENCE_EVENT, onLocalChange)
			}
		},
		[machineId],
	)
	const getSnapshot = useCallback(() => readPreference(machineId), [machineId])
	const muted = useSyncExternalStore(subscribe, getSnapshot, () => false)
	const setMuted = useCallback(
		(value: boolean) => {
			memoryPreferences.set(machineId, value)
			try {
				localStorage.setItem(preferenceKey(machineId), String(value))
			} catch {
				// Audio still changes for this page through the local event even if
				// storage is unavailable (for example, strict private-browsing modes).
			}
			window.dispatchEvent(new CustomEvent(AUDIO_PREFERENCE_EVENT, {detail: machineId}))
		},
		[machineId],
	)
	return {muted, setMuted}
}
