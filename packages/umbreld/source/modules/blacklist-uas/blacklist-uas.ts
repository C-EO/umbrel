import {globby} from 'globby'
import fse from 'fs-extra'
import {$} from 'execa'

const bootMountPath = `/tmp/umbrel-boot-${process.pid}`

// Parse a USB device's sysfs uevent and return its `<vendorId>:<productId>` if
// it's bound to the uas driver, otherwise undefined. The vid/pid come from the
// PRODUCT= field (idVendor/idProduct/bcdDevice in hex, unpadded).
export function parseUasDeviceId(uevent: string): string | undefined {
	if (!uevent.includes('DRIVER=uas')) return undefined
	const productLine = uevent.split('\n').find((line) => line?.startsWith('PRODUCT='))
	if (!productLine) return undefined
	const [vendorId, productId] = productLine.replace('PRODUCT=', '').split('/')
	return `${vendorId}:${productId}`
}

// Return a new kernel cmdline that forces the given devices onto the USB
// mass-storage driver. Any existing usb-storage.quirks flag is replaced (not
// merged) with one listing every device, each with the `:u` (ignore UAS) quirk.
export function applyUasQuirks(cmdline: string, deviceIds: string[]): string {
	const withoutExistingQuirks = cmdline
		.trim()
		.split(' ')
		.filter((flag) => !flag.startsWith('usb-storage.quirks='))
		.join(' ')
	const quirks = deviceIds.map((deviceId) => `${deviceId}:u`).join(',')
	return `${withoutExistingQuirks} usb-storage.quirks=${quirks}`
}

// By default Linux uses the UAS driver for most devices. This causes major
// stability problems on the Raspberry Pi 4, not due to issues with UAS, but due
// to devices running in UAS mode using much more power. The Pi can't reliably
// provide enough power to the USB port and the entire system experiences
// extreme instability. By blacklisting all devices from the UAS driver on first
// and then rebooting we fall back to the mass-storage driver, which results in
// decreased performance, but lower power usage, and much better system stability.
//
// We use console.err for logs so they appear in umbrel-external-storage logs and
// console.log to signal to the mount script that we're rebooting.
export default async function blacklistUASDriver() {
	try {
		console.error('Checking for UAS devices to blacklist')
		// Only run on Raspberry Pi 4
		const cpuInfo = await fse.readFile('/proc/cpuinfo')
		if (!cpuInfo.includes('Raspberry Pi 4 ')) {
			console.error('Not running on Pi 4, exiting...')
			return
		}
		console.error('Running on Pi 4')
		const blacklist = []
		// Get all USB device uevent files
		const usbDeviceUeventFiles = await globby('/sys/bus/usb/devices/*/uevent')
		for (const ueventFile of usbDeviceUeventFiles) {
			const uevent = await fse.readFile(ueventFile, 'utf8')
			const deviceId = parseUasDeviceId(uevent)
			if (!deviceId) continue
			console.error(`UAS device found ${deviceId}`)
			blacklist.push(deviceId)
		}

		const {stdout: systemInfoJson} = await $`rugix-ctrl system info --json`
		const systemInfo = JSON.parse(systemInfoJson) as {boot?: {activeGroup?: string}}
		// Rugix's rpi-tryboot layout uses partition 2 for boot-a and partition 3 for boot-b.
		const bootPartition =
			systemInfo.boot?.activeGroup === 'a' ? 2 : systemInfo.boot?.activeGroup === 'b' ? 3 : undefined
		if (!bootPartition) throw new Error('Could not determine active boot partition')
		const {stdout} = await $`rugix-ctrl utils resolve-partition ${bootPartition}`
		const {device} = JSON.parse(stdout) as {device?: string}
		if (!device) throw new Error(`Could not resolve boot partition ${bootPartition}`)
		await fse.ensureDir(bootMountPath)
		let bootMounted = false
		try {
			await $`mount -o rw ${device} ${bootMountPath}`
			bootMounted = true
			const justDidRebootFile = `${bootMountPath}/umbrel-just-did-reboot`

			// Don't reboot if we don't have any UAS devices
			if (blacklist.length === 0) {
				console.error('No UAS devices found!')
				await fse.remove(justDidRebootFile)
				return
			}

			// Check we're not in a boot loop
			if (await fse.pathExists(justDidRebootFile)) {
				console.error('We just rebooted, we could be in a bootloop, skipping reboot')
				await fse.remove(justDidRebootFile)
				return
			}

			// Read current cmdline
			console.error(`Applying quirks to cmdline.txt`)
			let cmdline = await fse.readFile(`${bootMountPath}/cmdline.txt`, 'utf8')

			// Don't apply quirks if they're already applied
			const quirksAlreadyApplied = blacklist.every((deviceId) => cmdline.includes(`${deviceId}:u`))
			if (quirksAlreadyApplied) {
				console.error('UAS quirks already applied, skipping')
				return
			}

			// Replace any current quirks with ones for the detected UAS devices
			cmdline = applyUasQuirks(cmdline, blacklist)

			// Write new cmdline
			await fse.writeFile(`${bootMountPath}/cmdline.txt`, cmdline)
			await fse.writeFile(justDidRebootFile, cmdline)
			await $`sync`
		} finally {
			if (bootMounted) await $`umount ${bootMountPath}`
			await fse.remove(bootMountPath)
		}

		// Reboot the system
		console.error(`Rebooting`)
		// We must make exactly this console log so we can detect a reboot in the mount script and halt
		console.log('mount-script-halt')
		// We need to make sure we commit before rebooting otherwise
		// OTA updates will get instantly rolled back.
		try {
			await $`rugix-ctrl system commit`
		} catch {}
		await $`reboot`
		return true
	} catch (error) {
		console.error(`Failed to blacklist UAS driver: ${(error as Error).message}`)
	}
}
