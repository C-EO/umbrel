// @vitest-environment jsdom
import {describe, expect, test} from 'vitest'

import {isProgressButtonDisabled} from './progress-button'

describe('isProgressButtonDisabled', () => {
	test('defers settled-state eligibility to the caller', () => {
		expect(isProgressButtonDisabled('not-installed')).toBe(false)
		expect(isProgressButtonDisabled('ready')).toBe(false)
		expect(isProgressButtonDisabled('running')).toBe(false)
		expect(isProgressButtonDisabled('stopped')).toBe(false)
		expect(isProgressButtonDisabled('unknown')).toBe(false)
	})

	test.each(['installing', 'updating', 'uninstalling', 'starting', 'restarting', 'stopping'] as const)(
		'locks the button while %s',
		(state) => expect(isProgressButtonDisabled(state)).toBe(true),
	)

	test('combines the lifecycle lock with the caller lock', () => {
		expect(isProgressButtonDisabled('ready', true)).toBe(true)
		expect(isProgressButtonDisabled('stopped', true)).toBe(true)
		expect(isProgressButtonDisabled('installing', false)).toBe(true)
		expect(isProgressButtonDisabled('loading', false)).toBe(true)
	})
})
