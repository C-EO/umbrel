import z from 'zod'

import {OWNER_USER_ID} from '../user/constants.js'

import {
	router,
	privateProcedure,
	privateProcedureWithMembers,
	publicProcedureWhenNoUserExists,
	publicProcedureWhenNoUserExistsWithMembers,
} from '../server/trpc/trpc.js'

export default router({
	// List a directory
	list: publicProcedureWhenNoUserExistsWithMembers
		.input(
			z.object({
				path: z.string(),
				sortBy: z.enum(['name', 'type', 'modified', 'size']).default('name'),
				sortOrder: z.enum(['ascending', 'descending']).default('ascending'),
				lastFile: z.string().optional(),
				limit: z.number().positive().default(100),
			}),
		)
		.query(async ({ctx, input}) => {
			const directoryListing = await ctx.umbreld.files.list(input.path, ctx.principal?.accountId)
			const totalFiles = directoryListing.files.length

			// Sort the files
			// Ensure numeric sort falls back to text sort if the numeric values are equal.
			// This is to ensure deterministic ordering in the case where multiple files have
			// the same size/date. If ordering becomes non-deterministic then pagination can break.
			// We enable numeric sorting by name, e.g. 1.txt, 2.txt, 10.txt
			const textSort = new Intl.Collator('en-US', {numeric: true})
			directoryListing.files.sort((fileA, fileB) => {
				const a = fileA[input.sortBy]
				const b = fileB[input.sortBy]
				if (typeof a === 'string' && typeof b === 'string') return textSort.compare(a, b)
				if (typeof a === 'number' && typeof b === 'number') return a - b || textSort.compare(fileA.name, fileB.name)
				return 0
			})

			// Handle sort order
			if (input.sortOrder === 'descending') directoryListing.files.reverse()

			// Paginate using cursor-style pagination with `lastFile` as the cursor.
			// Unlike offset-based pagination, this ensures consistent results even if files are added, removed, or renamed, etc.
			// as it starts after the last seen file rather than relying on fixed indices.
			let startIndex = 0
			if (input.lastFile) {
				const lastFileIndex = directoryListing.files.findIndex((file) => file.name === input.lastFile)
				// If lastFile found, start after it; otherwise start from beginning
				startIndex = lastFileIndex !== -1 ? lastFileIndex + 1 : 0
			}

			// Get the paginated files
			const paginatedFiles = directoryListing.files.slice(startIndex, startIndex + input.limit)

			// Determine if there are more files after this batch
			const hasMore = startIndex + input.limit < totalFiles

			return {
				...directoryListing,
				// overwrite the files with the paginated files
				files: paginatedFiles,
				totalFiles,
				hasMore,
			}
		}),

	// Create a directory
	createDirectory: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.createDirectory(input.path, ctx.principal?.accountId)),

	// Copy a file or directory
	copy: privateProcedureWithMembers
		.input(
			z.object({
				path: z.string(),
				toDirectory: z.string(),
				collision: z.enum(['error', 'keep-both', 'replace']).default('error'),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.copy(input.path, input.toDirectory, {
				collision: input.collision,
				userId: ctx.principal?.accountId,
			}),
		),

	// Move a file or directory
	move: privateProcedureWithMembers
		.input(
			z.object({
				path: z.string(),
				toDirectory: z.string(),
				collision: z.enum(['error', 'keep-both', 'replace']).default('error'),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.move(input.path, input.toDirectory, {
				collision: input.collision,
				userId: ctx.principal?.accountId,
			}),
		),

	// Get progress of the current account's file operations
	operationProgress: privateProcedureWithMembers.query(async ({ctx}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		return ctx.umbreld.files.operationsInProgress.filter((operation) => operation.userId === userId)
	}),

	// Rename a file or directory
	rename: privateProcedureWithMembers
		.input(z.object({path: z.string(), newName: z.string().nonempty()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.rename(input.path, input.newName, ctx.principal?.accountId)),

	// Trash a file or directory
	trash: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.trash(input.path, ctx.principal?.accountId)),

	// Restore a file or directory from the trash
	restore: privateProcedureWithMembers
		.input(z.object({path: z.string(), collision: z.enum(['error', 'keep-both', 'replace']).default('error')}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.restore(input.path, {collision: input.collision, userId: ctx.principal?.accountId}),
		),

	// Empty the trash
	emptyTrash: privateProcedureWithMembers.mutation(async ({ctx}) =>
		ctx.umbreld.files.emptyTrash(ctx.principal?.accountId),
	),

	// Permanently delete a file or directory
	delete: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.delete(input.path, ctx.principal?.accountId)),

	// Get favorites
	favorites: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.favorites.listFavorites()),

	// Add a favorite
	addFavorite: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.favorites.addFavorite(input.path)),

	// Remove a favorite
	removeFavorite: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.favorites.removeFavorite(input.path)),

	// Get recent files
	recents: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.recents.get()),

	// Get the current account's view preferences
	// Public only when no user exists for onboarding restore flow (returns defaults); private once a user exists
	viewPreferences: publicProcedureWhenNoUserExistsWithMembers.query(async ({ctx}) =>
		ctx.umbreld.files.getViewPreferences(ctx.principal?.accountId),
	),

	// Update the current account's view preferences
	updateViewPreferences: privateProcedureWithMembers
		.input(
			z.object({
				view: z.enum(['icons', 'list']).optional(),
				sortBy: z.enum(['name', 'type', 'modified', 'size']).optional(),
				sortOrder: z.enum(['ascending', 'descending']).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.updateViewPreferences(input, ctx.principal?.accountId)),

	// Create a zip archive
	archive: privateProcedureWithMembers
		.input(z.object({paths: z.array(z.string()).min(1)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.archive.archive(input.paths, ctx.principal?.accountId)),

	// Unarchive a file
	unarchive: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.archive.unarchive(input.path, ctx.principal?.accountId)),

	// Get/generate a thumbnail for a file on demand
	getThumbnail: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.thumbnails.getThumbnailOnDemand(input.path, ctx.principal?.accountId),
		),

	// ── Member shares ───────────────────────────────────────────────────────
	// Owner paths shared with member accounts, distinct from samba network
	// shares below. External and network storage are granted by category root.

	// List all member shares (owner management view)
	memberShares: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.memberShares.list()),

	// Share a path with all members or specific members. Upserts, so sharing an
	// already shared path updates who it's shared with.
	addMemberShare: privateProcedure
		.input(
			z.object({
				path: z.string(),
				sharedWith: z.union([z.literal('all'), z.array(z.string()).min(1)]),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.memberShares.add(input.path, input.sharedWith)),

	// Stop sharing a path
	removeMemberShare: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.memberShares.remove(input.path)),

	// The paths shared with the current member account (drives their sidebar)
	sharedWithMe: privateProcedureWithMembers.query(async ({ctx}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		const owner = await ctx.umbreld.user.get()
		const shares = await ctx.umbreld.files.memberShares.listForUser(userId)
		return {
			ownerName: owner?.name ?? '',
			shares: shares.map((share) => {
				const segments = share.path.split('/').filter(Boolean)
				const base =
					segments[0] === 'External'
						? 'external'
						: segments[0] === 'Network'
							? 'network'
							: segments[0] === 'Apps'
								? 'apps'
								: 'home'
				return {
					path: share.path,
					name: share.path === '/Home' ? 'Home' : segments[segments.length - 1],
					base: base as 'home' | 'external' | 'network' | 'apps',
				}
			}),
		}
	}),

	// Get the share password
	sharePassword: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.samba.getSharePassword()),

	// Get shares
	shares: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.samba.listShares()),

	// Share a directory
	addShare: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.addShare(input.path)),

	// Remove a share
	removeShare: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.removeShare(input.path)),

	// Format an external device
	formatExternalDevice: privateProcedure
		.input(
			z.object({
				deviceId: z.string(),
				filesystem: z.enum(['ext4', 'exfat']),
				label: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.externalStorage.formatExternalDevice(input)),

	// Get external storage devices
	externalDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.files.externalStorage.getExternalDevicesWithVirtualMountPoints(),
	),

	// Unmount an external device
	unmountExternalDevice: privateProcedure
		.input(z.object({deviceId: z.string()}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.externalStorage.unmountExternalDevice(input.deviceId, {remove: true}),
		),

	// Search for a file in the current account's home directory
	search: privateProcedureWithMembers
		.input(
			z.object({
				query: z.string(),
				maxResults: z.number().positive().max(1000).default(250).optional(),
			}),
		)
		.query(async ({ctx, input}) =>
			ctx.umbreld.files.search.search(input.query, input.maxResults, ctx.principal?.accountId),
		),

	// List network shares
	listNetworkShares: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.files.networkStorage.getShareInfo(),
	),

	// Add a network share
	addNetworkShare: publicProcedureWhenNoUserExists
		.input(
			z.object({
				host: z.string(),
				share: z.string(),
				username: z.string(),
				password: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.networkStorage.addShare(input)),

	// Remove a network share
	removeNetworkShare: privateProcedure
		.input(z.object({mountPath: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.networkStorage.removeShare(input.mountPath)),

	// Discover available network share servers
	discoverNetworkShareServers: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.files.networkStorage.discoverServers(),
	),

	// Discover shares for a given samba server
	discoverNetworkSharesOnServer: publicProcedureWhenNoUserExists
		.input(z.object({host: z.string(), username: z.string(), password: z.string()}))
		.query(async ({ctx, input}) =>
			ctx.umbreld.files.networkStorage.discoverSharesOnServer(input.host, input.username, input.password),
		),

	// Checks if the given network address is an Umbrel device
	isServerAnUmbrelDevice: privateProcedure
		.input(z.object({address: z.string()}))
		.query(async ({ctx, input}) => ctx.umbreld.files.networkStorage.isServerAnUmbrelDevice(input.address)),
})
