// A single app cannot safely run two lifecycle mutations at once. This guard
// closes the short gap before optimistic query state reaches every button and
// is shared across all hook/provider instances in this browser tab.
const activeAppActions = new Set<string>()

export function beginAppAction(appId: string): boolean {
	if (!appId || activeAppActions.has(appId)) return false
	activeAppActions.add(appId)
	return true
}

export function finishAppAction(appId: string): void {
	activeAppActions.delete(appId)
}
