// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import type {CloudAccount, CloudProvider} from '@/features/files/hooks/use-cloud'

import {ConnectStep} from './connect-step'

const mocks = vi.hoisted(() => ({
	beginICloud: vi.fn(),
	continueICloud: vi.fn(),
	connectWebDav: vi.fn(),
	pinSubmit: undefined as undefined | ((code: string) => Promise<boolean>),
}))

vi.mock('react-i18next', () => ({
	initReactI18next: {type: '3rdParty', init: vi.fn()},
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('motion/react', () => ({
	motion: {
		p: ({children, className}: {children?: React.ReactNode; className?: string}) => (
			<p className={className}>{children}</p>
		),
	},
}))
vi.mock('@/components/ui/alert-dialog', () => ({
	AlertDialog: ({open, children}: {open: boolean; children: React.ReactNode}) => (open ? <div>{children}</div> : null),
	AlertDialogAction: ({
		children,
		onClick,
	}: {
		children: React.ReactNode
		onClick?: React.MouseEventHandler<HTMLButtonElement>
	}) => <button onClick={onClick}>{children}</button>,
	AlertDialogContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	AlertDialogDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
	AlertDialogFooter: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	AlertDialogHeader: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	AlertDialogTitle: ({children}: {children: React.ReactNode}) => <h2>{children}</h2>,
}))
vi.mock('@/components/ui/dialog', () => ({
	DialogFooter: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
vi.mock('@/components/ui/input', () => ({
	Input: ({value, onValueChange}: {value: string; onValueChange: (value: string) => void}) => (
		<input value={value} onChange={(event) => onValueChange(event.target.value)} />
	),
	PasswordInput: ({value, onValueChange}: {value: string; onValueChange: (value: string) => void}) => (
		<input type='password' value={value} onChange={(event) => onValueChange(event.target.value)} />
	),
}))
vi.mock('@/components/ui/pin-input', () => ({
	PinInput: ({disabled, onCodeCheck}: {disabled?: boolean; onCodeCheck: (code: string) => Promise<boolean>}) => {
		mocks.pinSubmit = onCodeCheck
		return <div data-testid='pin' data-disabled={String(disabled)} />
	},
}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/features/files/components/shared/cloud-constellation', () => ({CloudLinkDiagram: () => <div />}))
vi.mock('@/features/files/hooks/use-cloud', () => ({
	useCloudConnect: () => ({
		beginICloud: mocks.beginICloud,
		continueICloud: mocks.continueICloud,
		connectWebDav: mocks.connectWebDav,
		isBeginningICloud: false,
		isConnectingWebDav: false,
	}),
	useCloudOAuth: vi.fn(),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const provider = {
	id: 'icloud',
	displayName: 'iCloud Drive',
	connectionKind: 'icloud',
} as CloudProvider

let root: Root | undefined
let container: HTMLDivElement

beforeEach(() => {
	vi.clearAllMocks()
	mocks.pinSubmit = undefined
	container = document.createElement('div')
	document.body.appendChild(container)
	const nextRoot = createRoot(container)
	root = nextRoot
	act(() => nextRoot.render(<ConnectStep provider={provider} onConnected={vi.fn()} onBack={vi.fn()} />))
})

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
})

const buttonWithText = (text: string) =>
	[...container.querySelectorAll('button')].find((button) => button.textContent === text)

const setInput = (input: HTMLInputElement, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
	act(() => {
		setter?.call(input, value)
		input.dispatchEvent(new Event('input', {bubbles: true}))
	})
}

it('serializes iCloud choice, PIN, and SMS challenge controls', async () => {
	mocks.beginICloud.mockResolvedValue({
		complete: false,
		accountId: '11111111-1111-4111-8111-111111111111',
		challenge: {
			state: 'choose_phone',
			step: 'config_2fa_phone',
			prompt: 'Choose a trusted device',
			choices: [
				{value: '0', displayName: 'Phone A'},
				{value: '1', displayName: 'Phone B'},
			],
		},
	})
	setInput(container.querySelector<HTMLInputElement>('input:not([type="password"])')!, 'ada@example.com')
	setInput(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'password')
	await act(async () => buttonWithText('files-cloud.connect')?.click())

	let resolveChoice!: (result: unknown) => void
	mocks.continueICloud.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveChoice = resolve
		}),
	)
	act(() => {
		buttonWithText('Phone A')?.click()
		buttonWithText('Phone B')?.click()
	})

	expect(mocks.continueICloud).toHaveBeenCalledOnce()
	expect(mocks.continueICloud).toHaveBeenCalledWith({
		accountId: '11111111-1111-4111-8111-111111111111',
		result: '0',
	})
	expect(buttonWithText('Phone A')?.disabled).toBe(true)
	expect(buttonWithText('Phone B')?.disabled).toBe(true)
	expect(buttonWithText('cancel')?.disabled).toBe(true)

	await act(async () => {
		resolveChoice({
			complete: false,
			accountId: '11111111-1111-4111-8111-111111111111',
			challenge: {state: 'enter_code', step: 'config_2fa', prompt: 'Enter the code'},
		})
	})

	let resolvePin!: (result: unknown) => void
	mocks.continueICloud.mockReturnValueOnce(
		new Promise((resolve) => {
			resolvePin = resolve
		}),
	)
	let pinCompletion!: Promise<boolean>
	act(() => {
		pinCompletion = mocks.pinSubmit!('123456')
		buttonWithText('files-cloud.icloud-2fa-sms')?.click()
	})

	expect(mocks.continueICloud).toHaveBeenCalledTimes(2)
	expect(mocks.continueICloud).toHaveBeenLastCalledWith({
		accountId: '11111111-1111-4111-8111-111111111111',
		result: '123456',
	})
	expect(container.querySelector('[data-testid="pin"]')?.getAttribute('data-disabled')).toBe('true')
	expect(buttonWithText('files-cloud.icloud-2fa-sms')?.disabled).toBe(true)
	expect(buttonWithText('cancel')?.disabled).toBe(true)

	resolvePin({
		complete: false,
		accountId: '11111111-1111-4111-8111-111111111111',
		challenge: {state: 'enter_code_again', step: 'config_2fa_sms', prompt: 'Enter the next code'},
	})
	await act(() => pinCompletion)
})

it('reuses a saved certificate policy only for the saved WebDAV URL', async () => {
	const webDavProvider = {
		id: 'webdav',
		displayName: 'WebDAV',
		connectionKind: 'webdav',
	} as CloudProvider
	const account = {
		id: '11111111-1111-4111-8111-111111111111',
		userId: '0',
		provider: 'webdav',
		identity: 'ada\nhttps://dav.example/',
		displayName: 'Ada · dav.example',
		connection: {
			kind: 'webdav',
			flavor: 'webdav',
			url: 'https://dav.example/',
			username: 'ada',
			tlsMode: 'insecure',
		},
	} as CloudAccount
	mocks.connectWebDav.mockResolvedValue({
		account,
		locations: {locations: [], truncated: false},
	})
	act(() =>
		root?.render(
			<ConnectStep
				provider={webDavProvider}
				reauthAccountId={account.id}
				savedWebDavConnection={account.connection.kind === 'webdav' ? account.connection : undefined}
				onConnected={vi.fn()}
				onBack={vi.fn()}
			/>,
		),
	)
	const [url, username] = container.querySelectorAll<HTMLInputElement>('input:not([type="password"])')
	const password = container.querySelector<HTMLInputElement>('input[type="password"]')!
	expect(url.value).toBe('https://dav.example/')
	expect(username.value).toBe('ada')

	setInput(password, 'secret')
	await act(async () => buttonWithText('files-cloud.connect')?.click())

	expect(mocks.connectWebDav).toHaveBeenLastCalledWith({
		accountId: account.id,
		flavor: 'webdav',
		url: 'https://dav.example/',
		username: 'ada',
		password: 'secret',
		tlsMode: 'insecure',
	})

	setInput(url, 'https://other.example/')
	await act(async () => buttonWithText('files-cloud.connect')?.click())

	expect(mocks.connectWebDav).toHaveBeenLastCalledWith({
		accountId: account.id,
		flavor: 'webdav',
		url: 'https://other.example/',
		username: 'ada',
		password: 'secret',
		tlsMode: 'default',
	})
})
