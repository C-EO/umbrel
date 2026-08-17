import {execa} from 'execa'
import fse from 'fs-extra'
import systemInformation from 'systeminformation'
import type {Compose} from 'compose-spec-schema'

export type GpuAcceleration = {
	// DRI render/card nodes provide Vulkan and existing Intel/AMD video acceleration.
	dri: boolean
	// KFD plus DRI provides the host device contract required by ROCm/HIP.
	rocm: boolean
	// The NVIDIA device reservation invokes the container toolkit for CUDA and
	// NVIDIA's Vulkan implementation.
	nvidia: boolean
	deviceGroupIds: number[]
}

export type GpuInfo = {
	gpus: {vendor: string; model: string}[]
}

const stripPciId = (value: string) => value.replace(/\s+\[[0-9a-f]{4}\]$/i, '')

// `systeminformation` only reports PCI class 0300 on some hosts. Modern APUs,
// including Strix Halo, can instead identify as 0380 (other display
// controller), so parse every PCI display subclass from lspci.
export function parsePciGraphicsControllers(output: string): GpuInfo['gpus'] {
	return output.split('\n').flatMap((line) => {
		const fields = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1])
		if (fields.length < 3 || !/\[03[0-9a-f]{2}\]$/i.test(fields[0])) return []
		return [{vendor: stripPciId(fields[1]), model: stripPciId(fields[2])}]
	})
}

async function getGpuControllers(): Promise<GpuInfo['gpus']> {
	try {
		const {stdout} = await execa('lspci', ['-D', '-mm', '-nn', '-d', '::03xx'])
		const controllers = parsePciGraphicsControllers(stdout)
		if (controllers.length > 0) return controllers
	} catch {
		// Fall back on platforms without pciutils, such as development hosts.
	}

	const graphics = await systemInformation.graphics().catch(() => ({controllers: []}))
	return graphics.controllers.map((controller) => ({
		vendor: controller.vendor ?? '',
		model: controller.model ?? '',
	}))
}

export type ComposeService = NonNullable<Compose['services']>[string]

// Remember only the compose values added by umbreld so a later hardware probe
// can remove them without touching equivalent settings supplied by the app.
export type AppliedGpuAcceleration = {
	devices?: string[]
	deviceGroupIds?: number[]
	nvidiaReservation?: boolean
	environment?: Record<string, string>
}

const DRI_DEVICE_PATH = '/dev/dri'
const KFD_DEVICE_PATH = '/dev/kfd'
const DOCKER_INFO_TIMEOUT_MS = 5_000
const NVIDIA_SMI_TIMEOUT_MS = 15_000

let gpuDetectionInFlight: Promise<GpuAcceleration> | undefined

// A configured runtime is not enough: hot-plugged NVIDIA hardware must also be
// usable by the driver before an app's compose file requests it.
async function hasNvidiaContainerSupport(): Promise<boolean> {
	try {
		const [{stdout: runtimesJson}, {stdout: gpus}] = await Promise.all([
			execa('docker', ['info', '--format', '{{json .Runtimes}}'], {timeout: DOCKER_INFO_TIMEOUT_MS}),
			execa('nvidia-smi', ['--list-gpus'], {timeout: NVIDIA_SMI_TIMEOUT_MS}),
		])
		const runtimes = JSON.parse(runtimesJson) as Record<string, unknown>
		return Boolean(runtimes.nvidia) && gpus.trim().length > 0
	} catch {
		return false
	}
}

// GPU nodes are normally root:video or root:render with mode 0660. Add their
// numeric host groups so non-root app containers can use the mapped devices
// without assuming distro-specific group ids.
async function getDeviceGroupIds(): Promise<number[]> {
	const deviceNodes = [KFD_DEVICE_PATH]
	try {
		const driNodes = await fse.readdir(DRI_DEVICE_PATH)
		deviceNodes.push(...driNodes.map((node) => `${DRI_DEVICE_PATH}/${node}`))
	} catch {
		// No DRI devices are available.
	}

	const groupIds = new Set<number>()
	for (const deviceNode of deviceNodes) {
		try {
			const stats = await fse.stat(deviceNode)
			if (stats.gid !== 0) groupIds.add(stats.gid)
		} catch {
			// The optional device node does not exist.
		}
	}
	return [...groupIds].sort((a, b) => a - b)
}

// Detect every usable acceleration path. These are additive: a mixed AMD and
// NVIDIA system needs ROCm, generic DRI/Vulkan, and NVIDIA injection at once.
export async function getGpuAcceleration(): Promise<GpuAcceleration> {
	// Apps start concurrently at boot. Share only the in-flight probe so they do
	// not each spawn docker/nvidia-smi, but do not cache the result after it
	// settles because an eGPU can be hot-plugged at any time.
	if (gpuDetectionInFlight) return gpuDetectionInFlight
	gpuDetectionInFlight = (async () => {
		const [dri, kfd, nvidia, deviceGroupIds] = await Promise.all([
			fse.pathExists(DRI_DEVICE_PATH),
			fse.pathExists(KFD_DEVICE_PATH),
			// nvidia-smi initializes NVIDIA's lazily-created device nodes. Probe it
			// even when /dev/nvidiactl does not exist yet after an eGPU is allowed.
			hasNvidiaContainerSupport(),
			getDeviceGroupIds(),
		])
		return {dri, rocm: dri && kfd, nvidia, deviceGroupIds}
	})()

	try {
		return await gpuDetectionInFlight
	} finally {
		gpuDetectionInFlight = undefined
	}
}

export async function getGpuInfo(): Promise<GpuInfo> {
	return {gpus: await getGpuControllers()}
}

const hasDeviceMapping = (devices: string[], path: string) =>
	devices.some((device) => device === path || device.startsWith(`${path}:`))

function setDefaultEnvironment(service: ComposeService, key: string, value: string): boolean {
	if (Array.isArray(service.environment)) {
		if (service.environment.some((entry) => entry.split('=', 1)[0] === key)) return false
		service.environment.push(`${key}=${value}`)
		return true
	}

	service.environment ??= {}
	if (key in service.environment) return false
	service.environment[key] = value
	return true
}

function removeMatchingValue<T>(values: T[] | undefined, value: T): void {
	if (!values) return
	const index = values.findIndex((existing) => String(existing) === String(value))
	if (index !== -1) values.splice(index, 1)
}

// Remove only values recorded as framework additions by the previous probe.
// App-provided GPU settings were never recorded and therefore remain intact.
export function removeGpuAccelerationFromService(
	service: ComposeService,
	applied: AppliedGpuAcceleration | undefined,
): void {
	if (!applied) return

	for (const device of applied.devices ?? []) removeMatchingValue(service.devices, device)
	if (service.devices?.length === 0) delete service.devices

	for (const groupId of applied.deviceGroupIds ?? []) removeMatchingValue(service.group_add, groupId)
	if (service.group_add?.length === 0) delete service.group_add

	if (applied.nvidiaReservation) {
		const reservations = service.deploy?.resources?.reservations?.devices
		const index = reservations?.findIndex(
			({driver, count, capabilities}) =>
				driver === 'nvidia' && count === 'all' && capabilities?.length === 1 && capabilities[0] === 'gpu',
		)
		if (index !== undefined && index !== -1) reservations!.splice(index, 1)
		if (reservations?.length === 0) delete service.deploy!.resources!.reservations!.devices
		if (Object.keys(service.deploy?.resources?.reservations ?? {}).length === 0)
			delete service.deploy!.resources!.reservations
		if (Object.keys(service.deploy?.resources ?? {}).length === 0) delete service.deploy!.resources
		if (Object.keys(service.deploy ?? {}).length === 0) delete service.deploy
	}

	for (const [key, value] of Object.entries(applied.environment ?? {})) {
		if (Array.isArray(service.environment)) {
			removeMatchingValue(service.environment, `${key}=${value}`)
		} else if (service.environment?.[key] === value) {
			delete service.environment[key]
		}
	}
	if (Array.isArray(service.environment) && service.environment.length === 0) delete service.environment
	if (!Array.isArray(service.environment) && Object.keys(service.environment ?? {}).length === 0)
		delete service.environment
}

// Temporary migration cleanup: older umbreld releases injected /dev/dri
// without recording ownership. No current app-store compose file defines this
// mapping itself, so remove every untracked legacy form before applying the
// ownership-tracked patch. This can be removed after persisted app compose
// files have had sufficient time to migrate.
export function removeLegacyDriDeviceMappingsFromService(service: ComposeService): void {
	service.devices = service.devices?.filter(
		(device) => device !== DRI_DEVICE_PATH && !device.startsWith(`${DRI_DEVICE_PATH}:`),
	)
	if (service.devices?.length === 0) delete service.devices
}

// Apply every available host capability without replacing app-provided compose
// settings and return an exact record of the framework additions.
export function applyGpuAccelerationToService(
	service: ComposeService,
	acceleration: GpuAcceleration,
): AppliedGpuAcceleration {
	const applied: AppliedGpuAcceleration = {}
	const devices = (service.devices ??= [])
	for (const devicePath of [acceleration.dri && DRI_DEVICE_PATH, acceleration.rocm && KFD_DEVICE_PATH].filter(
		(devicePath): devicePath is string => Boolean(devicePath),
	)) {
		if (!hasDeviceMapping(devices, devicePath)) {
			devices.push(devicePath)
			;(applied.devices ??= []).push(devicePath)
		}
	}

	if (acceleration.dri || acceleration.rocm) {
		const groupAdd = (service.group_add ??= [])
		for (const groupId of acceleration.deviceGroupIds) {
			if (!groupAdd.some((existing) => String(existing) === String(groupId))) {
				groupAdd.push(groupId)
				;(applied.deviceGroupIds ??= []).push(groupId)
			}
		}
	}

	if (acceleration.nvidia) {
		service.deploy ??= {}
		service.deploy.resources ??= {}
		service.deploy.resources.reservations ??= {}
		const reservations = (service.deploy.resources.reservations.devices ??= [])
		if (!reservations.some(({driver}) => driver === 'nvidia')) {
			reservations.push({driver: 'nvidia', count: 'all', capabilities: ['gpu']})
			applied.nvidiaReservation = true
		}

		// `all` includes graphics so the same reservation supports NVIDIA Vulkan,
		// CUDA, compute, video, and utility libraries supplied by the host toolkit.
		for (const [key, value] of [
			['NVIDIA_VISIBLE_DEVICES', 'all'],
			['NVIDIA_DRIVER_CAPABILITIES', 'all'],
		] as const) {
			if (setDefaultEnvironment(service, key, value)) (applied.environment ??= {})[key] = value
		}
	}

	// Avoid writing empty framework-owned arrays on systems without a GPU.
	if (service.devices.length === 0) delete service.devices
	return applied
}
