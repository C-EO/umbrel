/**
 * The last visited Files path is per-user, per-tab state: it lets the Dock and
 * Cmdk reopen Files where the user left off. Keying sessionStorage by the
 * account id keeps the state with its owner, so signing in as another user in
 * the same tab never inherits (or leaks) someone else's location. Readers fall
 * back to the Files home route when there is no entry for the current user.
 */
export function getLastFilesPath(userId: string | undefined): string | null {
	return userId ? sessionStorage.getItem(`lastFilesPath:${userId}`) : null
}

export function setLastFilesPath(userId: string | undefined, path: string): void {
	if (userId) sessionStorage.setItem(`lastFilesPath:${userId}`, path)
}
