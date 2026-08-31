import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import type {Context} from '../server/trpc/context.js'
import type {CloudSyncActivity} from '../files/cloud-types.js'
import routes from './routes.js'

test('Cloud subscriptions discard another account wake-up before yielding', async () => {
	const ownerActivity: CloudSyncActivity = {
		syncId: '11111111-1111-4111-8111-111111111111',
		bytesPerSecond: 1,
		transferredFiles: 1,
		transferredBytes: 1,
	}
	const memberActivity: CloudSyncActivity = {
		syncId: '22222222-2222-4222-8222-222222222222',
		bytesPerSecond: 2,
		transferredFiles: 2,
		transferredBytes: 2,
	}
	const setupOrder: string[] = []
	const stream = vi.fn(() => {
		setupOrder.push('stream')
		return (async function* () {
			yield {userId: '0', activity: [ownerActivity]}
			yield {userId: 'Alice', activity: [memberActivity]}
		})()
	})
	const getActivity = vi.fn(() => {
		setupOrder.push('snapshot')
		return [memberActivity]
	})
	const umbreld = {
		auth: {validatePrincipal: vi.fn(async () => {})},
		eventBus: {stream},
		files: {cloud: {getActivity}},
	} as unknown as Umbreld
	const context = {
		umbreld,
		transport: 'ws',
		principal: {sessionId: 'member-session', accountId: 'Alice', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context

	const subscription = await routes.createCaller(context).listen({event: 'files:cloud-progress'})
	const iterator = subscription[Symbol.asyncIterator]()

	await expect(iterator.next()).resolves.toEqual({done: false, value: [memberActivity]})
	await expect(iterator.next()).resolves.toEqual({done: false, value: [memberActivity]})
	expect(setupOrder).toEqual(['stream', 'snapshot'])
	expect(getActivity).toHaveBeenCalledWith('Alice')
	expect(stream).toHaveBeenCalledWith('files:cloud-progress', {signal: undefined})
	await iterator.return?.()
})

test('Photos subscriptions expose only the requesting account activity to members', async () => {
	const stream = vi.fn(() =>
		(async function* () {
			yield {accountIds: ['0']}
			yield {accountIds: ['0', 'Bob', 'Alice']}
		})(),
	)
	const umbreld = {
		auth: {validatePrincipal: vi.fn(async () => {})},
		eventBus: {stream},
	} as unknown as Umbreld
	const context = {
		umbreld,
		transport: 'ws',
		principal: {sessionId: 'member-session', accountId: 'Alice', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context

	const subscription = await routes.createCaller(context).listen({event: 'photos:change'})
	const iterator = subscription[Symbol.asyncIterator]()
	await expect(iterator.next()).resolves.toEqual({done: false, value: {accountIds: ['Alice']}})
	await iterator.return?.()
})
