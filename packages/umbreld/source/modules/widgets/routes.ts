import z from 'zod'
import ms from 'ms'

import {router, privateProcedure, privateProcedureWithMembers} from '../server/trpc/trpc.js'
import {OWNER_USER_ID} from '../user/constants.js'
import {systemWidgets} from '../system/system-widgets.js'
import {filesWidgets} from '../files/widgets.js'

const MAX_ALLOWED_WIDGETS = 3

const umbrelWidgets = {...systemWidgets, ...filesWidgets}

// Splits a widgetId into appId and widgetName
// e.g., "transmission:status" => { appId: "transmission", widgetName: "status" }
function splitWidgetId(widgetId: string) {
	const [appId, widgetName] = widgetId.split(':')

	return {appId, widgetName}
}

export default router({
	// List enabled widgets.
	// Members don't have widgets yet so they get an empty list rather than a
	// permission error, letting the desktop render for them.
	enabled: privateProcedureWithMembers.query(async ({ctx}) => {
		if (ctx.principal?.accountId !== OWNER_USER_ID) return []
		const widgetIds = (await ctx.umbreld.store.get('widgets')) || []

		return widgetIds
	}),

	// Enable widget
	enable: privateProcedure
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const {appId, widgetName} = splitWidgetId(input.widgetId)

			// Validate widget
			if (appId === 'umbrel') {
				// This is an Umbrel widget
				if (!(widgetName in umbrelWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel widgets`)
			} else {
				// This is an app widget
				// Throws an error if the widget doesn't exist
				await ctx.apps.getApp(appId).getWidgetMetadata(widgetName)
			}

			// Save widget ID
			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const widgets = (await get('widgets')) || []

				// Check if widget is already active
				if (widgets.includes(input.widgetId)) throw new Error(`Widget ${input.widgetId} is already enabled`)

				// Check we don't have more than 3 widgets enabled
				if (widgets.length >= MAX_ALLOWED_WIDGETS)
					throw new Error(`The maximum number of widgets (${MAX_ALLOWED_WIDGETS}) has already been enabled`)

				widgets.push(input.widgetId)
				await set('widgets', widgets)
			})

			return true
		}),

	// Disable widget
	disable: privateProcedure
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Remove widget ID
			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const widgets = await get('widgets')

				// Check if widget is currently enabled
				if (!widgets.includes(input.widgetId)) throw new Error(`Widget ${input.widgetId} is not enabled`)

				// Remove widget
				const updatedWidgets = widgets.filter((widget) => widget !== input.widgetId)
				await set('widgets', updatedWidgets)
			})

			return true
		}),

	// Get live data for a widget
	data: privateProcedureWithMembers
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => {
			const {appId, widgetName} = splitWidgetId(input.widgetId)
			const accountId = ctx.principal!.accountId
			let widgetData: {[key: string]: any}

			if (appId === 'umbrel') {
				// This is an Umbrel widget
				if (!(widgetName in umbrelWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel widgets`)

				if (widgetName in filesWidgets) {
					widgetData = await filesWidgets[widgetName as keyof typeof filesWidgets](ctx.umbreld, accountId)
				} else {
					widgetData = await systemWidgets[widgetName as keyof typeof systemWidgets](ctx.umbreld)
				}
			} else {
				// This is an app widget
				if (accountId !== OWNER_USER_ID && !(await ctx.umbreld.apps.sharedAppIdsForUser(accountId)).includes(appId)) {
					throw new Error('[widget-not-found]')
				}
				widgetData = await ctx.apps.getApp(appId).getWidgetData(widgetName)
			}

			// Parse refresh time from human-readable string to milliseconds
			widgetData.refresh = ms(widgetData.refresh)

			return widgetData
		}),
})
