import {afterEach, describe, expect, test} from 'vitest'

import {beginAppAction, finishAppAction} from './app-action-guard'

afterEach(() => {
	finishAppAction('a')
	finishAppAction('b')
})

describe('app action guard', () => {
	test('allows only one in-flight action per app', () => {
		expect(beginAppAction('a')).toBe(true)
		expect(beginAppAction('a')).toBe(false)

		finishAppAction('a')
		expect(beginAppAction('a')).toBe(true)
	})

	test('does not block actions for other apps', () => {
		expect(beginAppAction('a')).toBe(true)
		expect(beginAppAction('b')).toBe(true)
	})
})
