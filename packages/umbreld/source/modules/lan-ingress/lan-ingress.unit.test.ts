import {describe, expect, test, vi} from 'vitest'

const {dockerCommand, execaDollar} = vi.hoisted(() => {
	const dockerCommand = vi.fn()
	return {dockerCommand, execaDollar: vi.fn(() => dockerCommand)}
})

vi.mock('execa', () => ({$: execaDollar}))

import LanIngress, {appAuthDashboardRedirect} from './lan-ingress.js'

describe('app auth navigation redirect', () => {
	test.each([
		{
			name: 'HTTP root',
			input: {protocol: 'http' as const, host: 'umbrel.local:2000', url: '/', method: 'GET', accept: 'text/html'},
			expected: 'http://umbrel.local/',
		},
		{
			name: 'HTTPS dashboard path',
			input: {
				protocol: 'https' as const,
				host: 'umbrel.local:2000',
				url: '/settings?dialog=about',
				method: 'GET',
				accept: 'text/html,application/xhtml+xml',
			},
			expected: 'https://umbrel.local/settings?dialog=about',
		},
		{
			name: 'IPv6 host',
			input: {protocol: 'http' as const, host: '[fd00::1]:2000', url: '/', method: 'GET', accept: 'text/html'},
			expected: 'http://[fd00::1]/',
		},
		{
			name: 'HTTP protocol-relative request target',
			input: {
				protocol: 'http' as const,
				host: 'umbrel.local:2000',
				url: '//attacker.example:2000/phish?from=umbrel',
				method: 'GET',
				accept: 'text/html',
			},
			expected: 'http://umbrel.local/phish?from=umbrel',
		},
		{
			name: 'HTTPS protocol-relative request target',
			input: {
				protocol: 'https' as const,
				host: 'umbrel.local:2000',
				url: '//attacker.example:2000/phish?from=umbrel',
				method: 'GET',
				accept: 'text/html',
			},
			expected: 'https://umbrel.local/phish?from=umbrel',
		},
	])('redirects a $name navigation to the main dashboard origin', ({input, expected}) => {
		expect(appAuthDashboardRedirect(input)).toBe(expected)
	})

	test.each([
		{
			name: 'allowed app-auth page',
			input: {
				protocol: 'http' as const,
				host: 'umbrel.local:2000',
				url: '/app-auth?app=files',
				method: 'GET',
				accept: 'text/html',
			},
		},
		{
			name: 'Tor auth hidden service',
			input: {
				protocol: 'http' as const,
				host: `${'a'.repeat(56)}.onion`,
				url: '/',
				method: 'GET',
				accept: 'text/html',
			},
		},
		{
			name: 'API request',
			input: {
				protocol: 'http' as const,
				host: 'umbrel.local:2000',
				url: '/unexpected',
				method: 'POST',
				accept: 'application/json',
			},
		},
	])('does not redirect an $name', ({input}) => {
		expect(appAuthDashboardRedirect(input)).toBeUndefined()
	})
})

describe('LAN ingress app targets', () => {
	test('resolves a compose container on the Umbrel network', async () => {
		dockerCommand.mockResolvedValue({
			exitCode: 0,
			stdout: JSON.stringify({
				umbrel_main_network: {IPAddress: '10.21.0.3'},
				other_network: {IPAddress: '172.18.0.2'},
			}),
		})
		const logger = {createChildLogger: () => logger}
		const ingress = new LanIngress({dataDirectory: '/tmp', logger} as never) as unknown as {
			inspectContainerAddress(container: string): Promise<string | null>
		}

		await expect(ingress.inspectContainerAddress('transmission_server_1')).resolves.toBe('10.21.0.3')
		expect(dockerCommand.mock.calls[0]?.slice(1)).toEqual([
			'{{json .NetworkSettings.Networks}}',
			'transmission_server_1',
		])
	})

	test('coalesces failures and refreshes as soon as a replacement container gets a new IP', async () => {
		const logger = {createChildLogger: () => logger, log: vi.fn(), error: vi.fn()}
		const ingress = new LanIngress({dataDirectory: '/tmp', logger} as never)
		const internals = ingress as unknown as {
			resolveAppTarget(appId: string, host: string, compose: unknown): Promise<string | null>
			requestAppTargetRecovery(config: {
				appId: string
				targetHost: string
				targetAddress: string
			}): Promise<void> | undefined
		}
		const resolveTarget = vi
			.spyOn(internals, 'resolveAppTarget')
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('10.21.0.9')
		const refresh = vi.spyOn(ingress, 'refresh').mockResolvedValue()
		const config = {appId: 'files', targetHost: 'files_web_1', targetAddress: '10.21.0.3'}

		const recovery = internals.requestAppTargetRecovery(config)
		expect(internals.requestAppTargetRecovery(config)).toBe(recovery)
		await recovery

		expect(resolveTarget).toHaveBeenCalledTimes(2)
		expect(refresh).toHaveBeenCalledTimes(1)

		// Further failures during the cooldown do not start another Docker probe.
		expect(internals.requestAppTargetRecovery(config)).toBeUndefined()
		expect(resolveTarget).toHaveBeenCalledTimes(2)
	})
})
