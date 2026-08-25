// @vitest-environment jsdom
import {describe, expect, test} from 'vitest'

import {getInstallButtonAction} from './install-button'

describe('getInstallButtonAction', () => {
	test('keeps Open available for a running or ready installed app', () => {
		expect(getInstallButtonAction('ready')).toBe('open')
		expect(getInstallButtonAction('running')).toBe('open')
	})

	test('offers Install only before installation', () => {
		expect(getInstallButtonAction('not-installed')).toBe('install')
	})

	test.each(['installing', 'updating', 'uninstalling', 'starting', 'restarting', 'stopping'] as const)(
		'has no primary action while %s',
		(state) => expect(getInstallButtonAction(state)).toBeUndefined(),
	)
})
