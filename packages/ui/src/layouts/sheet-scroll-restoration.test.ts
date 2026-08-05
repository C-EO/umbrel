import {NavigationType} from 'react-router-dom'
import {describe, expect, it} from 'vitest'

import {getSheetScrollRestorationAction} from './sheet-scroll-restoration'

describe('Sheet scroll restoration', () => {
	it('resets the shared Sheet viewport when entering Settings', () => {
		expect(getSheetScrollRestorationAction('/settings', '/app-store', NavigationType.Push)).toBe('reset')
		expect(getSheetScrollRestorationAction('/settings', '/files/Home', NavigationType.Push)).toBe('reset')
	})

	it('leaves the shared viewport alone between nested Settings routes', () => {
		expect(getSheetScrollRestorationAction('/settings/users', '/settings', NavigationType.Push)).toBe('ignore')
		expect(getSheetScrollRestorationAction('/settings', '/settings/advanced/network', NavigationType.Pop)).toBe(
			'ignore',
		)
	})

	it('preserves the existing App Store back-navigation behavior', () => {
		expect(getSheetScrollRestorationAction('/app-store', '/app-store/example', NavigationType.Pop)).toBe('restore')
		expect(getSheetScrollRestorationAction('/app-store', '/settings', NavigationType.Push)).toBe('reset')
	})
})
