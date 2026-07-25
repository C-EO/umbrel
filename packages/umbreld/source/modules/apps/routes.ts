import z from 'zod'

import {router, privateProcedure, privateProcedureWithMembers} from '../server/trpc/trpc.js'
import {OWNER_USER_ID} from '../user/constants.js'

export const appStore = router({
	// Returns the app store registry.
	// Members get the sanitized public registry too so they can browse the app
	// store read-only; repository management data remains owner-only.
	registry: privateProcedureWithMembers.query(async ({ctx}) => ctx.appStore.publicRegistry()),

	// Repository locations can contain credentials or private hostnames.
	repositories: privateProcedure.query(async ({ctx}) => ctx.appStore.listRepositories()),

	// Add a repository to the app store
	addRepository: privateProcedure
		.input(
			z.object({
				url: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.appStore.addRepository(input.url)),

	// Remove a repository to the app store
	removeRepository: privateProcedure
		.input(
			z.object({
				url: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.appStore.removeRepository(input.url)),
})

export const apps = router({
	// ── Member shares (owner only) ──────────────────────────────────────────
	// List all app shares
	memberShares: privateProcedure.query(async ({ctx}) => ctx.umbreld.apps.listMemberShares()),

	// Share an app with all members or specific members (upserts)
	addMemberShare: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				sharedWith: z.union([z.literal('all'), z.array(z.string()).min(1)]),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.apps.addMemberShare(input.appId, input.sharedWith)),

	// Stop sharing an app
	removeMemberShare: privateProcedure
		.input(z.object({appId: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.apps.removeMemberShare(input.appId)),

	// List all apps.
	// Members only get the apps that have been shared with them (empty when
	// nothing is shared, letting the desktop render for them).
	list: privateProcedureWithMembers.query(async ({ctx}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		let apps = ctx.apps.instances
		if (userId !== OWNER_USER_ID) {
			const sharedAppIds = await ctx.umbreld.apps.sharedAppIdsForUser(userId)
			apps = apps.filter((app) => sharedAppIds.includes(app.id))
			if (apps.length === 0) return []
		}
		const torEnabled = await ctx.umbreld.store.get('torEnabled')

		const appData = await Promise.all(
			apps.map(async (app) => {
				try {
					let [
						{
							name,
							version,
							icon,
							port,
							path,
							widgets,
							defaultUsername,
							defaultPassword,
							deterministicPassword,
							dependencies,
							implements: implements_,
							torOnly,
							requiresHttps,
						},
						selectedDependencies,
					] = await Promise.all([app.readManifest(), app.getSelectedDependencies()])

					const hiddenService = torEnabled ? await app.readHiddenService() : ''
					if (deterministicPassword) {
						defaultPassword = await app.deriveDeterministicPassword()
					}
					const hasCredentials = !!defaultUsername || !!defaultPassword
					const showCredentialsBeforeOpen = hasCredentials && !(await app.store.get('hideCredentialsBeforeOpen'))
					return {
						id: app.id,
						name,
						version,
						icon: icon ?? `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`,
						port,
						path,
						state: app.state,
						credentials: {
							defaultUsername,
							defaultPassword,
							showBeforeOpen: showCredentialsBeforeOpen,
						},
						hiddenService,
						widgets,
						dependencies,
						selectedDependencies,
						implements: implements_,
						torOnly,
						requiresHttps: requiresHttps === true,
					}
				} catch (error) {
					ctx.apps.logger.error(`Failed to read manifest for app ${app.id}`, error)
					return {id: app.id, error: (error as Error).message}
				}
			}),
		)

		const appDataSortedByNames = appData.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

		return appDataSortedByNames
	}),

	// Install an app
	install: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				alternatives: z.record(z.string()).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.install(input.appId, input.alternatives)),

	// Get state
	// Temporarily used for polling the state of app mutations until we implement subscriptions
	// App state. Members may query it for apps shared with them (their desktop
	// icons need it to become launchable). Apps not shared with them always
	// read as not installed so the app store renders read-only without leaking
	// what the owner has installed.
	state: privateProcedureWithMembers
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => {
			const userId = ctx.principal?.accountId ?? OWNER_USER_ID
			if (userId !== OWNER_USER_ID) {
				const sharedAppIds = await ctx.umbreld.apps.sharedAppIdsForUser(userId)
				if (!sharedAppIds.includes(input.appId)) {
					return {
						state: 'not-installed' as const,
						progress: 0,
					}
				}
			}
			if (!(await ctx.apps.isInstalled(input.appId))) {
				return {
					state: 'not-installed' as const,
					progress: 0,
				}
			}

			const app = ctx.apps.getApp(input.appId)

			return {
				state: app.state,
				progress: app.stateProgress,
			} as const
		}),

	// Uninstall an app
	uninstall: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.uninstall(input.appId)),

	// Restart an app
	restart: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.restart(input.appId)),

	// Start an app
	start: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.startApp(input.appId)),

	// Stop an app
	stop: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.getApp(input.appId).stop({persistState: true})),

	// Update an app
	update: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.update(input.appId)),

	// Get logs for an app
	logs: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => ctx.apps.getApp(input.appId).getLogs()),

	trackOpen: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.trackOpen(input.appId)),

	// Recently opened apps power cmd-k suggestions. Only tracked for the owner,
	// members get an empty list.
	recentlyOpened: privateProcedureWithMembers.query(({ctx}) => {
		if (ctx.principal?.accountId !== OWNER_USER_ID) return []
		return ctx.apps.recentlyOpened()
	}),

	setTorEnabled: privateProcedure.input(z.boolean()).mutation(({ctx, input}) => ctx.apps.setTorEnabled(input)),
	getTorEnabled: privateProcedure.query(({ctx}) => ctx.apps.getTorEnabled()),

	setSelectedDependencies: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				dependencies: z.record(z.string()),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.setSelectedDependencies(input.appId, input.dependencies)),

	dependents: privateProcedure.input(z.string()).query(async ({ctx, input}) => ctx.apps.getDependents(input)),

	hideCredentialsBeforeOpen: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				value: z.boolean(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.setHideCredentialsBeforeOpen(input.appId, input.value)),

	isBackupIgnored: privateProcedure
		.input(z.object({appId: z.string()}))
		.query(async ({ctx, input}) => ctx.apps.getApp(input.appId).isBackupIgnored()),

	backupIgnore: privateProcedure
		.input(z.object({appId: z.string(), value: z.boolean()}))
		.mutation(async ({ctx, input}) => ctx.apps.getApp(input.appId).setBackupIgnored(input.value)),

	// Get backupIgnored paths for an app
	getBackupIgnoredPaths: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => ctx.apps.getApp(input.appId).getBackupIgnoredFilePaths()),
})
