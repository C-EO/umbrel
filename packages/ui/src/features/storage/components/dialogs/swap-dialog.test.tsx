// @vitest-environment jsdom
import {act, type PropsWithChildren} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import type {RaidStatus, StorageDevice} from '../../hooks/use-storage'
import {SwapDialog} from './swap-dialog'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/features/storage/hooks/use-active-raid-operation', () => ({useActiveRaidOperation: () => operation}))
vi.mock('@/features/storage/providers/pending-operation-context', () => ({usePendingRaidOperation: () => ({})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('./shutdown-confirmation-dialog', () => ({ShutdownConfirmationDialog: () => null}))
vi.mock('./operation-in-progress-banner', () => ({OperationInProgressBanner: () => <div>operation-in-progress</div>}))
vi.mock('@/components/ui/dialog', () => {
	const Container = ({children}: PropsWithChildren) => <div>{children}</div>
	return Object.fromEntries(
		[
			'Dialog',
			'DialogContent',
			'DialogDescription',
			'DialogFooter',
			'DialogHeader',
			'DialogScrollableContent',
			'DialogTitle',
		].map((name) => [name, Container]),
	)
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let operation: {type: string} | undefined
const replace = vi.fn()
const member = (id: string, status = 'ONLINE') => ({id, status, readErrors: 0, writeErrors: 0, checksumErrors: 0})
const drive = (id: string, type = 'hdd') =>
	({id, type, size: 2e12, roundedSize: 2e12, smartStatus: 'healthy'}) as StorageDevice

beforeEach(() => {
	host = document.createElement('div')
	root = createRoot(host)
	operation = undefined
	replace.mockClear()
})
afterEach(() => act(() => root.unmount()))

async function render({
	checksum = 0,
	unhealthy = false,
	connected = false,
	pro = false,
	poolExists = true,
	target = 'missing',
	poolOperation = {} as Partial<RaidStatus>,
} = {}) {
	const pool = {
		exists: poolExists,
		status: 'DEGRADED',
		raidType: 'failsafe',
		topology: 'mirror',
		devices: [member('missing', 'UNAVAIL'), {...member('survivor'), checksumErrors: checksum}],
		mirrors: [['missing', 'survivor']],
		...poolOperation,
	} as RaidStatus
	const devices = [
		{...drive('survivor'), smartStatus: unhealthy ? 'unhealthy' : 'healthy'},
		...(connected ? [drive('missing')] : []),
	] as StorageDevice[]
	await act(async () =>
		root.render(
			<SwapDialog
				open
				onOpenChange={() => {}}
				raidType='failsafe'
				oldDeviceId={target}
				oldDeviceFailed
				isUmbrelPro={pro}
				missingDeviceType={pro ? 'ssd' : 'hdd'}
				raidStatus={pool}
				allDevices={devices}
				availableDevices={[]}
				replaceDeviceAsync={replace}
			/>,
		),
	)
}

test.each(['clean', 'checksum', 'SMART', 'scrub'])(
	'offers insertion for an absent FailSafe member when the survivor is %s',
	async (condition) => {
		if (condition === 'scrub') operation = {type: 'scrub'}
		await render({checksum: condition === 'checksum' ? 1 : 0, unhealthy: condition === 'SMART'})
		expect(host.textContent).toContain('storage-manager.swap.step-insert-new-ssd-drive')
		expect(host.textContent).toContain('storage-manager.swap.missing-description')
		expect(host.textContent).not.toContain('storage-manager.swap.leave-connected')
		expect(host.textContent).not.toContain('storage-manager.swap.data-protected')
		expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'shut-down')).toBe(true)
		expect(replace).not.toHaveBeenCalled()
	},
)

test('Pro insertion never tells the user to remove the absent SSD', async () => {
	await render({pro: true, unhealthy: true})
	expect(host.textContent).toContain('storage-manager.swap.pro-instructions-insert-1')
	expect(host.textContent).not.toContain('storage-manager.swap.pro-instructions-swap-1')
})

test('a connected failed member still cannot be removed with an unhealthy survivor', async () => {
	await render({connected: true, unhealthy: true})
	expect(host.textContent).toContain('storage-manager.swap.leave-connected')
	expect(host.textContent).not.toContain('storage-manager.swap.step-swap-ssd')
})

test.each(['replace', 'rebuild', 'expansion', 'failsafe-transition'])(
	'missing-member instructions wait for %s without claiming it is connected',
	async (type) => {
		operation = {type}
		await render()
		expect(host.textContent).toContain('storage-manager.swap.replacement-unavailable')
		expect(host.textContent).not.toContain('storage-manager.swap.leave-connected')
	},
)

test('a missing member of an unavailable pool cannot proceed', async () => {
	await render({poolExists: false})
	expect(host.textContent).toContain('storage-manager.swap.replacement-unavailable')
})

test('an unknown target does not bypass the removal checks', async () => {
	await render({target: 'not-a-member'})
	expect(host.textContent).toContain('storage-manager.swap.leave-connected')
})

test.each([
	{replace: {state: 'rebuilding'}},
	{replace: {state: 'expanding'}},
	{rebuild: {state: 'rebuilding'}},
	{expansion: {state: 'expanding'}},
	{failsafeTransitionStatus: {state: 'syncing'}},
])('waits for server-reported work before progress events arrive: %j', async (poolOperation) => {
	await render({poolOperation: poolOperation as Partial<RaidStatus>})
	expect(host.textContent).toContain('storage-manager.swap.replacement-unavailable')
})

test('a server-reported scrub still allows insertion for a missing member', async () => {
	await render({poolOperation: {scrub: {state: 'scrubbing'}} as Partial<RaidStatus>})
	expect(host.textContent).toContain('storage-manager.swap.step-insert-new-ssd-drive')
})
