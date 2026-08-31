import {describe, expect, it} from 'vitest'

import {takenAtClock} from './taken-at'

describe('takenAtClock', () => {
	it('keeps capture dates without an offset on the backend UTC calendar', () => {
		const clock = takenAtClock(Date.parse('2025-01-01T00:30:00Z'), undefined)
		expect(clock.timeZone).toBe('UTC')
		expect(
			new Intl.DateTimeFormat('en', {
				timeZone: clock.timeZone,
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			}).format(clock.date),
		).toBe('Jan 1, 2025')
	})
})
