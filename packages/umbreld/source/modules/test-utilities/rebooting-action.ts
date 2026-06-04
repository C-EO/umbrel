function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

const factoryResetCommands = ['rugix-ctrl state reset', 'reboot']

// Trigger an RPC action that reboots the VM, allowing the RPC to be interrupted by the reboot it starts.
export async function triggerRebootingAction(action: Promise<unknown>, expectedCommands = ['reboot']) {
	try {
		await action
	} catch (error) {
		const message = errorMessage(error)
		const actionStarted =
			message.includes('Command was killed with SIGTERM') &&
			expectedCommands.some((command) => message.includes(command))

		if (!actionStarted) throw error
	}
}

// Trigger a factory reset, allowing either Rugix reset or direct reboot to interrupt the RPC.
export async function triggerFactoryReset(reset: Promise<unknown>) {
	await triggerRebootingAction(reset, factoryResetCommands)
}
