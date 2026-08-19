import type {McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import type {McpPermissions} from '../mcp.js'
import {MAX_LOG_BYTES, newestLogs, runTool, type McpToolContext} from './shared.js'

// Mirrors the canonical validation in App and AppStore.
const appIdSchema = z.string().regex(/^[a-zA-Z0-9-_]+$/)

const appInput = z.object({
	appId: appIdSchema.describe('The installed app ID.'),
})
const appLogsInput = appInput.extend({
	lines: z
		.number()
		.int()
		.min(1)
		.overwrite((lines) => Math.min(lines, 500))
		.max(500)
		.default(200)
		.describe('Number of newest log lines to return (default 200, maximum 500).'),
})
const installReadyNote =
	'When the app reaches ready, call get_app_details and share its URL and any default login credentials with the user.'

async function registryApps(context: McpToolContext) {
	const registry = await context.rpc.appStore.registry()
	return registry.flatMap(({apps}) => apps)
}

async function installedAppIds(context: McpToolContext) {
	return new Set((await context.rpc.apps.list()).map(({id}) => id))
}

async function runAppOperation(
	context: McpToolContext,
	appId: string,
	operation: 'start' | 'stop' | 'restart' | 'update',
) {
	if (operation === 'start') return context.rpc.apps.start({appId})
	if (operation === 'stop') return context.rpc.apps.stop({appId})
	if (operation === 'restart') return context.rpc.apps.restart({appId})
	return context.rpc.apps.update({appId})
}

export default function registerAppTools(server: McpServer, context: McpToolContext, permissions: McpPermissions) {
	server.registerTool(
		'list_apps',
		{
			title: 'List installed apps',
			description:
				'List installed umbrelOS apps with their current state, progress, version, update availability, and implemented dependency IDs.',
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				// This also queries the public registry to calculate updateAvailable.
				openWorldHint: true,
			},
		},
		(input) =>
			runTool(context, 'list_apps', input, async () => {
				const [apps, registry] = await Promise.all([context.rpc.apps.list(), registryApps(context).catch(() => [])])
				const latestApps = new Map(registry.map((app) => [app.id, app]))
				return apps.map((app) => {
					if ('error' in app) return {id: app.id, error: app.error}
					const latestApp = latestApps.get(app.id)
					const updateAvailable = latestApp !== undefined && latestApp.version !== app.version
					return {
						id: app.id,
						name: app.name,
						version: app.version,
						state: app.state,
						progress: app.progress,
						updateAvailable,
						...(updateAvailable ? {updateCompatible: latestApp.compatible} : {}),
						...(app.implements ? {implements: app.implements} : {}),
					}
				})
			}),
	)

	server.registerTool(
		'get_app_status',
		{
			title: 'Get app status',
			description:
				'Get an app installation or lifecycle state, progress, and its most recent background-operation failure.',
			inputSchema: appInput,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'get_app_status', input, async () => {
				const failure = context.mcp.getAppOperationFailure(input.appId)
				const {state, progress} = await context.rpc.apps.state({appId: input.appId})
				return {appId: input.appId, state, progress, lastOperationFailure: failure}
			}),
	)

	const hasAppGrants = permissions.apps === 'all' || permissions.apps.length > 0

	// Also registered for App Store access alone so install_app's ready note names
	// a visible tool; the per-app grant check still runs on every call.
	if (hasAppGrants || permissions.appStore) {
		server.registerTool(
			'get_app_details',
			{
				title: 'Get app details',
				description:
					'Get details, launch URL, credentials, app-data path, resource usage, and installed dependents for a granted app.',
				inputSchema: appInput,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'get_app_details', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					// Keep resource snapshots sequential, and run the app's disk-usage
					// calculation only after it can no longer distort those readings.
					const memoryUsage = await context.rpc.system.memoryUsage()
					const cpuUsage = await context.rpc.system.cpuUsage()
					const [details, hostname] = await Promise.all([
						context.rpc.apps.details({appId: input.appId}),
						context.rpc.system.getHostname(),
					])
					const protocol = details.requiresHttps ? 'https' : 'http'
					const port = details.port ? `:${details.port}` : ''
					const path = details.path ? `/${details.path.replace(/^\/+/, '')}` : ''
					return {
						id: details.id,
						name: details.name,
						version: details.version,
						tagline: details.tagline,
						description: details.description,
						state: details.state,
						progress: details.progress,
						url: `${protocol}://${hostname}.local${port}${path}`,
						credentials: details.credentials,
						dataDirectory: `/Apps/${details.id}`,
						dependents: details.dependents,
						usage: {
							cpu: cpuUsage.apps.find(({id}) => id === details.id)?.used ?? 0,
							memory: memoryUsage.apps.find(({id}) => id === details.id)?.used ?? 0,
							disk: details.diskUsage,
						},
					}
				}),
		)
	}

	if (hasAppGrants) {
		server.registerTool(
			'get_app_logs',
			{
				title: 'Get app logs',
				description: 'Get the newest N container log lines for a granted app (default 200, maximum 500).',
				inputSchema: appLogsInput,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'get_app_logs', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					const logs = await context.rpc.apps.logs({appId: input.appId, maxOutputBytes: MAX_LOG_BYTES})
					return {appId: input.appId, ...newestLogs(logs, input.lines)}
				}),
		)

		for (const [name, title, description, operation, destructive, idempotent, openWorld] of [
			['start_app', 'Start app', 'Start a granted app and return immediately.', 'start', false, true, false],
			['stop_app', 'Stop app', 'Stop a granted app and return immediately.', 'stop', false, true, false],
			['restart_app', 'Restart app', 'Restart a granted app and return immediately.', 'restart', false, false, false],
			['update_app', 'Update app', 'Update a granted app and return immediately.', 'update', true, false, true],
		] as const) {
			server.registerTool(
				name,
				{
					title,
					description,
					inputSchema: appInput,
					annotations: {
						readOnlyHint: false,
						destructiveHint: destructive,
						idempotentHint: idempotent,
						openWorldHint: openWorld,
					},
				},
				(input) =>
					runTool(context, name, input, async () => {
						await context.mcp.assertAppAccess(input.appId)
						context.mcp.startAppOperation(input.appId, operation, async () => {
							await runAppOperation(context, input.appId, operation)
						})
						return {accepted: true, appId: input.appId, operation}
					}),
			)
		}

		server.registerTool(
			'uninstall_app',
			{
				title: 'Uninstall app',
				description:
					'Permanently uninstall a granted app and delete its app data. This cannot be recovered from Files Trash. Returns immediately while the operation continues.',
				inputSchema: appInput,
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'uninstall_app', input, async () => {
					await context.mcp.assertAppAccess(input.appId)
					context.mcp.startAppOperation(input.appId, 'uninstall', async () => {
						if (!(await context.rpc.apps.uninstall({appId: input.appId}))) {
							throw new Error(`Failed to uninstall '${input.appId}'`)
						}
					})
					return {accepted: true, appId: input.appId, operation: 'uninstall'}
				}),
		)
	}

	if (permissions.appStore) {
		server.registerTool(
			'search_app_store',
			{
				title: 'Search the App Store',
				description: 'Search the current public umbrelOS App Store registry by app ID, name, tagline, or description.',
				inputSchema: z.object({
					query: z.string().default('').describe('Search text. Use an empty string to browse.'),
					limit: z.number().int().min(1).max(50).default(20),
				}),
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'search_app_store', input, async () => {
					await context.mcp.assertAppStoreAccess()
					const query = input.query.trim().toLocaleLowerCase()
					const installed = await installedAppIds(context)
					return (await registryApps(context))
						.filter((app) =>
							[app.id, app.name, app.tagline, app.description].some((value) =>
								value?.toLocaleLowerCase().includes(query),
							),
						)
						.slice(0, input.limit)
						.map((app) => ({
							id: app.id,
							name: app.name,
							tagline: app.tagline,
							version: app.version,
							category: app.category,
							compatible: app.compatible,
							dependencies: app.dependencies ?? [],
							installed: installed.has(app.id),
						}))
				}),
		)

		server.registerTool(
			'get_app_store_details',
			{
				title: 'Get App Store app details',
				description:
					'Get the full description, install size, release notes, and dependencies for an App Store app before installing it.',
				inputSchema: z.object({
					appId: appIdSchema.describe('The App Store app ID.'),
				}),
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'get_app_store_details', input, async () => {
					await context.mcp.assertAppStoreAccess()
					const [apps, installed] = await Promise.all([registryApps(context), installedAppIds(context)])
					const app = apps.find((app) => app.id === input.appId)
					if (!app) throw new Error(`[app-not-found] App '${input.appId}' is not in the App Store`)
					return {
						id: app.id,
						name: app.name,
						version: app.version,
						tagline: app.tagline,
						description: app.description,
						category: app.category,
						compatible: app.compatible,
						dependencies: app.dependencies ?? [],
						implements: app.implements ?? [],
						installSize: app.installSize,
						releaseNotes: app.releaseNotes,
						installed: installed.has(input.appId),
					}
				}),
		)

		server.registerTool(
			'install_app',
			{
				title: 'Install app',
				description: `Install an App Store app and grant it to MCP, returning immediately while the operation continues. Call get_app_store_details first to review what the app does and its install size. Ensure its dependencies are installed first. The optional alternatives map a dependency ID to the installed app satisfying it (for example, bitcoin to bitcoin-knots). Installation failures surface through get_app_status. ${installReadyNote}`,
				inputSchema: z.object({
					appId: appIdSchema.describe('The App Store app ID to install.'),
					alternatives: z
						.record(z.string(), z.string())
						.optional()
						.describe('Dependency IDs mapped to installed apps that implement them.'),
				}),
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
					openWorldHint: true,
				},
			},
			(input) =>
				runTool(context, 'install_app', input, async () => {
					await context.mcp.assertAppStoreAccess()
					context.mcp.startAppOperation(input.appId, 'install', async () => {
						if (!(await context.rpc.apps.install({appId: input.appId, alternatives: input.alternatives}))) {
							throw new Error(`Failed to install '${input.appId}'`)
						}
						await context.mcp.addAppGrant(input.appId)
					})
					return {accepted: true, appId: input.appId, operation: 'install', note: installReadyNote}
				}),
		)
	}
}
