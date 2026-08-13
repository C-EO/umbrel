import type {CallToolResult, McpServer} from '@modelcontextprotocol/server'
import {beforeEach, expect, test, vi} from 'vitest'

import registerAppTools from './apps.js'
import registerFileTools from './files.js'
import type {McpToolContext} from './shared.js'
import registerSystemInfoTools from './system-info.js'
import registerSystemManagementTools from './system-management.js'

type ToolHandler = (input: Record<string, unknown>) => Promise<CallToolResult>

const logger = {error: vi.fn(), log: vi.fn()}

function toolRegistry() {
	const registerTool = vi.fn()
	return {
		server: {registerTool} as unknown as McpServer,
		get(name: string) {
			const registration = registerTool.mock.calls.find(([toolName]) => toolName === name)
			if (!registration) throw new Error(`Tool '${name}' was not registered`)
			return {
				config: registration[1] as {
					annotations: Record<string, boolean>
					description: string
					inputSchema: {parse: (input: unknown) => Record<string, unknown>}
				},
				handler: registration[2] as ToolHandler,
			}
		},
	}
}

function parseToolResult(result: CallToolResult) {
	const content = result.content[0]
	if (!content || content.type !== 'text') throw new Error('Expected a text tool result')
	if (result.isError) throw new Error(content.text)
	return JSON.parse(content.text) as unknown
}

function baseContext() {
	return {
		dataDirectory: '/umbrel',
		rpc: {
			systemNg: {device: {getSpecs: vi.fn()}},
			system: {
				version: vi.fn(async () => ({version: '1.2.3', name: 'umbrelOS 1.2.3', previousVersion: undefined})),
				status: vi.fn(async () => 'running'),
				getReleaseChannel: vi.fn(async () => 'stable'),
				getHostname: vi.fn(async () => 'umbrel'),
				getIpAddresses: vi.fn(async () => ['192.168.1.10']),
				uptime: vi.fn(async () => 123),
				cpuUsage: vi.fn(),
				memoryUsage: vi.fn(),
				systemDiskUsage: vi.fn(),
				cpuTemperature: vi.fn(),
				checkUpdate: vi.fn(),
				updateStatus: vi.fn(async () => ({running: false})),
				update: vi.fn(async () => true),
				restart: vi.fn(async () => true),
				setHostname: vi.fn(async ({hostname}: {hostname: string}) => hostname),
				setReleaseChannel: vi.fn(async () => undefined),
				getNetworkInterfaces: vi.fn(async () => []),
				isExternalDns: vi.fn(async () => true),
				logs: vi.fn(async () => ''),
			},
			hardware: {raid: {getStatus: vi.fn(async () => ({exists: false}))}},
			wifi: {connected: vi.fn(async () => ({status: 'disconnected'}))},
			notifications: {get: vi.fn(async () => [])},
			appStore: {registry: vi.fn(async () => [])},
			apps: {
				list: vi.fn(async () => []),
				state: vi.fn(async () => ({state: 'not-installed', progress: 0})),
				details: vi.fn(),
				logs: vi.fn(async () => ''),
				start: vi.fn(async () => true),
				stop: vi.fn(async () => true),
				restart: vi.fn(async () => true),
				update: vi.fn(async () => true),
				install: vi.fn(async () => true),
				uninstall: vi.fn(async () => true),
			},
			files: {
				status: vi.fn(),
				listDirectoryPage: vi.fn(),
				createDirectory: vi.fn(),
				copy: vi.fn(),
				move: vi.fn(),
				rename: vi.fn(),
				trash: vi.fn(),
				search: vi.fn(async () => []),
			},
		},
		mcp: {
			logger,
			getAppOperationFailure: vi.fn(),
			assertAppAccess: vi.fn(),
			assertAppStoreAccess: vi.fn(),
			assertSystemAccess: vi.fn(),
			addAppGrant: vi.fn(),
			startAppOperation: vi.fn(),
			normalizeFilePath: vi.fn((path: string) => path),
			allowedFileGrants: vi.fn(async () => ['/Home']),
			assertFileAccess: vi.fn(async (path: string) => ({path, systemPath: `/system${path}`, grant: '/Home'})),
			assertFileWriteAccess: vi.fn(async (path: string) => ({path, systemPath: `/system${path}`, grant: '/Home'})),
			hasFullHomeAccess: vi.fn(async () => true),
		},
	} as unknown as McpToolContext
}

beforeEach(() => vi.clearAllMocks())

test('system information uses routes and omits hardware identifiers', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.system.status).mockResolvedValue('updating')
	vi.mocked(context.rpc.system.getHostname).mockResolvedValue('homebox')
	vi.mocked(context.rpc.systemNg.device.getSpecs).mockResolvedValue({
		deviceId: 'U130121',
		device: 'Umbrel Home (2024)',
		productName: 'Umbrel Home',
		manufacturer: 'Umbrel',
		model: 'U130121',
		serial: 'SN0123456789',
		uuid: '4c4c4544-0043-3010-8043-b7c04f4d5632',
		cpu: 'Intel N150',
		memorySize: 16,
		memoryType: 'DDR5',
		storageSize: 2_000,
		storageType: 'NVMe SSD',
	} as never)

	const registry = toolRegistry()
	registerSystemInfoTools(registry.server, context)
	expect(parseToolResult(await registry.get('get_system_info').handler({}))).toStrictEqual({
		version: '1.2.3',
		versionName: 'umbrelOS 1.2.3',
		status: 'updating',
		releaseChannel: 'stable',
		hostname: 'homebox',
		ipAddresses: ['192.168.1.10'],
		uptimeSeconds: 123,
		deviceId: 'U130121',
		device: 'Umbrel Home (2024)',
		productName: 'Umbrel Home',
		manufacturer: 'Umbrel',
		model: 'U130121',
		cpu: 'Intel N150',
		memorySize: 16,
		memoryType: 'DDR5',
		storageSize: 2_000,
		storageType: 'NVMe SSD',
	})
})

test('system resources includes compact RAID health only when a pool exists', async () => {
	const context = baseContext()
	const cpu = {threads: 4, totalUsed: 20, system: 20, apps: []}
	const memory = {size: 1_000, totalUsed: 500, system: 400, apps: []}
	const storage = {size: 2_000, totalUsed: 800, available: 1_200}
	const temperature = {warning: 'normal' as const, temperature: 42}
	vi.mocked(context.rpc.system.cpuUsage).mockResolvedValue(cpu)
	vi.mocked(context.rpc.system.memoryUsage).mockResolvedValue(memory)
	vi.mocked(context.rpc.system.systemDiskUsage).mockResolvedValue(storage)
	vi.mocked(context.rpc.system.cpuTemperature).mockResolvedValue(temperature)

	const registry = toolRegistry()
	registerSystemInfoTools(registry.server, context)
	const handler = registry.get('get_system_resources').handler
	expect(parseToolResult(await handler({}))).toStrictEqual({cpu, memory, storage, temperature})

	vi.mocked(context.rpc.hardware.raid.getStatus).mockResolvedValueOnce({
		exists: true,
		status: 'DEGRADED',
		rebuild: {state: 'rebuilding', progress: 45},
		devices: [{id: 'disk-1', status: 'FAULTED', readErrors: 2, writeErrors: 1, checksumErrors: 3}],
	} as never)
	expect(parseToolResult(await handler({}))).toMatchObject({
		storageHealth: {status: 'DEGRADED', degraded: true, rebuild: {state: 'rebuilding', progress: 45}},
	})

	vi.mocked(context.rpc.system.cpuTemperature).mockRejectedValueOnce(new Error('No CPU temperature sensor'))
	const withoutTemperature = parseToolResult(await handler({})) as Record<string, unknown>
	expect(withoutTemperature).toMatchObject({cpu, memory, storage})
	expect(withoutTemperature).not.toHaveProperty('temperature')
})

test('app details aggregates app and system routes into the compact MCP response', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.apps.details).mockResolvedValue({
		id: 'bitcoin',
		name: 'Bitcoin Core',
		version: '28.0',
		tagline: 'Run Bitcoin',
		description: 'A node',
		state: 'ready',
		progress: 100,
		port: 8332,
		path: 'dashboard',
		requiresHttps: true,
		credentials: {username: 'umbrel', password: 'secret'},
		diskUsage: 123,
		dependents: ['electrs'],
	} as never)
	vi.mocked(context.rpc.system.getHostname).mockResolvedValue('homebox')
	vi.mocked(context.rpc.system.memoryUsage).mockResolvedValue({apps: [{id: 'bitcoin', used: 100}]} as never)
	vi.mocked(context.rpc.system.cpuUsage).mockResolvedValue({apps: [{id: 'bitcoin', used: 5}]} as never)

	const registry = toolRegistry()
	registerAppTools(registry.server, context, {apps: ['bitcoin'], appStore: false, files: [], manageSystem: false})
	expect(parseToolResult(await registry.get('get_app_details').handler({appId: 'bitcoin'}))).toMatchObject({
		id: 'bitcoin',
		url: 'https://homebox.local:8332/dashboard',
		credentials: {username: 'umbrel', password: 'secret'},
		dependents: ['electrs'],
		usage: {cpu: 5, memory: 100, disk: 123},
	})
	expect(context.mcp.assertAppAccess).toHaveBeenCalledWith('bitcoin')
	expect(context.rpc.apps.details).toHaveBeenCalledWith({appId: 'bitcoin'})
})

test('App Store tools return compact summaries and forward install alternatives through routes', async () => {
	const context = baseContext()
	const storeApp = {
		id: 'wallet',
		name: 'Wallet',
		tagline: 'A Bitcoin wallet',
		version: '1.2.3',
		category: 'Finance',
		description: 'A deliberately long description',
		dependencies: ['bitcoin'],
		installSize: 1_000_000,
		releaseNotes: 'Adds coin control',
	}
	vi.mocked(context.rpc.appStore.registry).mockResolvedValue([{apps: [storeApp]}] as never)
	vi.mocked(context.rpc.apps.list).mockResolvedValue([
		{
			id: 'bitcoin-knots',
			name: 'Bitcoin Knots',
			version: '28.1',
			state: 'ready',
			progress: 100,
			implements: ['bitcoin'],
		},
	] as never)
	let operation: Promise<void> | undefined
	vi.mocked(context.mcp.startAppOperation).mockImplementation((_appId, _name, task) => {
		operation = task()
	})

	const registry = toolRegistry()
	registerAppTools(registry.server, context, {apps: [], appStore: true, files: [], manageSystem: false})
	expect(parseToolResult(await registry.get('list_apps').handler({}))).toMatchObject([
		{id: 'bitcoin-knots', progress: 100, implements: ['bitcoin']},
	])
	expect(parseToolResult(await registry.get('search_app_store').handler({query: 'wallet', limit: 20}))).toMatchObject([
		{id: 'wallet', installed: false},
	])
	expect(parseToolResult(await registry.get('get_app_store_details').handler({appId: 'wallet'}))).toMatchObject({
		...storeApp,
		implements: [],
		installed: false,
	})

	await registry.get('install_app').handler({appId: 'wallet', alternatives: {bitcoin: 'bitcoin-knots'}})
	if (!operation) throw new Error('Install operation was not started')
	await operation
	expect(context.rpc.apps.install).toHaveBeenCalledWith({
		appId: 'wallet',
		alternatives: {bitcoin: 'bitcoin-knots'},
	})
	expect(context.mcp.addAppGrant).toHaveBeenCalledWith('wallet')
	expect(() => registry.get('get_app_details')).not.toThrow()
	expect(() => registry.get('get_app_logs')).toThrow()
})

test('app logs clamp requests, bound the route output and retain only the newest safe lines', async () => {
	const context = baseContext()
	const tenLines = Array.from({length: 10}, (_line, index) => `line ${index + 1}`).join('\n')
	vi.mocked(context.rpc.apps.logs).mockResolvedValue(`${tenLines}\n`)
	const registry = toolRegistry()
	registerAppTools(registry.server, context, {apps: ['bitcoin'], appStore: false, files: [], manageSystem: false})
	const tool = registry.get('get_app_logs')

	const input = tool.config.inputSchema.parse({appId: 'bitcoin', lines: 5_000})
	expect(input).toStrictEqual({appId: 'bitcoin', lines: 500})
	expect(parseToolResult(await tool.handler({...input, lines: 3}))).toStrictEqual({
		appId: 'bitcoin',
		logs: 'line 8\nline 9\nline 10',
	})
	expect(context.rpc.apps.logs).toHaveBeenCalledWith({appId: 'bitcoin', maxOutputBytes: 64_000})

	const fatLine = 'y'.repeat(2_000)
	vi.mocked(context.rpc.apps.logs).mockResolvedValue(
		[...Array.from({length: 40}, () => fatLine), 'x'.repeat(3_000)].join('\n'),
	)
	const result = parseToolResult(await tool.handler({appId: 'bitcoin', lines: 500})) as {
		logs: string
		truncated: boolean
		droppedLines: number
	}
	expect(result.truncated).toBe(true)
	expect(result.droppedLines).toBe(10)
	expect(Buffer.byteLength(result.logs)).toBeLessThanOrEqual(64_000)
})

test('system logs require system access and pass bounds through the route', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.system.logs).mockResolvedValue('line one\nline two')
	const registry = toolRegistry()
	registerSystemManagementTools(registry.server, context)
	const tool = registry.get('get_system_logs')

	const input = tool.config.inputSchema.parse({type: 'umbrelos', lines: 15_000})
	expect(input).toStrictEqual({type: 'umbrelos', lines: 1500})
	expect(parseToolResult(await tool.handler(input))).toStrictEqual({logs: 'line one\nline two'})
	expect(context.mcp.assertSystemAccess).toHaveBeenCalledOnce()
	expect(context.rpc.system.logs).toHaveBeenCalledWith({type: 'umbrelos', lines: 1500, maxOutputBytes: 64_000})
})

test('directory listing retains grant checks while delegating listing to Files', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.files.listDirectoryPage).mockResolvedValue({
		name: 'Home',
		path: '/Home',
		type: 'directory',
		size: 0,
		modified: 0,
		operations: [],
		files: [{name: 'one.txt', path: '/Home/one.txt', type: 'text/plain', size: 1, modified: 0, operations: []}],
		totalFiles: 1,
		hasMore: false,
	} as never)
	const registry = toolRegistry()
	registerFileTools(registry.server, context, {apps: [], appStore: false, files: ['/Home'], manageSystem: false})
	expect(parseToolResult(await registry.get('list_directory').handler({path: '/Home', limit: 2}))).toMatchObject({
		path: '/Home',
		files: [{name: 'one.txt'}],
		totalFiles: 1,
		hasMore: false,
	})
	expect(context.mcp.assertFileAccess).toHaveBeenCalledWith('/Home')
	expect(context.rpc.files.listDirectoryPage).toHaveBeenCalledWith({path: '/Home', lastFile: undefined, limit: 2})
})

test('file transfers never expose replacement and explain safe collision choices', async () => {
	const context = baseContext()
	vi.mocked(context.rpc.files.copy).mockResolvedValue('/Home/Destination/report (2).txt')
	const registry = toolRegistry()
	registerFileTools(registry.server, context, {apps: [], appStore: false, files: ['/Home'], manageSystem: false})
	const copy = registry.get('copy')
	const move = registry.get('move')

	for (const tool of [copy, move]) {
		expect(() =>
			tool.config.inputSchema.parse({
				path: '/Home/report.txt',
				toDirectory: '/Home/Destination',
				collision: 'replace',
			}),
		).toThrow()
	}
	expect(
		parseToolResult(
			await copy.handler({path: '/Home/report.txt', toDirectory: '/Home/Destination', collision: 'keep-both'}),
		),
	).toMatchObject({path: '/Home/Destination/report (2).txt', note: expect.stringContaining('original was unchanged')})
	expect(context.mcp.assertFileWriteAccess).toHaveBeenCalledWith('/Home/Destination/report.txt')

	vi.mocked(context.rpc.files.copy).mockRejectedValueOnce(new Error('[destination-already-exists]'))
	const conflict = await copy.handler({path: '/External/report.txt', toDirectory: '/Network/share', collision: 'error'})
	expect(conflict).toMatchObject({isError: true})
	expect(conflict.content[0]).toMatchObject({type: 'text', text: expect.stringContaining('USB/network items')})
})

test('app IDs and tool annotations preserve the MCP contract', () => {
	const context = baseContext()
	const systemInfo = toolRegistry()
	registerSystemInfoTools(systemInfo.server, context)
	const apps = toolRegistry()
	registerAppTools(apps.server, context, {apps: ['installed'], appStore: true, files: [], manageSystem: false})
	const systemManagement = toolRegistry()
	registerSystemManagementTools(systemManagement.server, context)
	const files = toolRegistry()
	registerFileTools(files.server, context, {apps: [], appStore: false, files: ['/Home'], manageSystem: false})

	const longAppId = 'a'.repeat(65)
	expect(apps.get('get_app_status').config.inputSchema.parse({appId: longAppId})).toMatchObject({appId: longAppId})
	expect(() => apps.get('get_app_status').config.inputSchema.parse({appId: 'invalid/app'})).toThrow()
	for (const [registry, name, openWorld] of [
		[systemInfo, 'check_os_update', true],
		[systemInfo, 'get_system_info', false],
		[apps, 'list_apps', true],
		[apps, 'update_app', true],
		[apps, 'restart_app', false],
		[systemManagement, 'install_os_update', true],
		[systemManagement, 'restart_device', false],
	] as const) {
		expect(registry.get(name).config.annotations.openWorldHint).toBe(openWorld)
	}
	expect(systemManagement.get('restart_device').config.annotations.destructiveHint).toBe(true)
	expect(files.get('trash').config.annotations.destructiveHint).toBe(true)
	expect(files.get('copy').config.annotations.destructiveHint).toBe(false)
})
