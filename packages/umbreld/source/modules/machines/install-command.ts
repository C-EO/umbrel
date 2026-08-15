export const MACHINE_INSTALL_COMMAND_TIMEOUT_MS = 4 * 60 * 60 * 1_000
export const MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS = 5 * 60 * 1_000
export const MACHINE_INSTALL_CLEANUP_TIMEOUT_MS = 30_000

export function installCommandOptions(signal: AbortSignal, timeout = MACHINE_INSTALL_COMMAND_TIMEOUT_MS) {
	return {signal, timeout, cleanup: true}
}
