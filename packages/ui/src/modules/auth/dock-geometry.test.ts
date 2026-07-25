import {describe, expect, it} from 'vitest'

import {AVATAR_SIZE, calculateDockLayout, DOCK_GAP} from '@/modules/auth/dock-geometry'
import {arrangeAccounts, type Account} from '@/modules/auth/use-account-picker'

function accounts(count: number): Account[] {
	return Array.from({length: count}, (_, index) => ({
		userId: index === 0 ? 'owner' : `member-${index}`,
		name: index === 0 ? 'Owner' : `Member ${index}`,
	}))
}

describe('calculateDockLayout', () => {
	it.each([2, 3, 12])('calculates stable geometry for %i accounts', (accountCount) => {
		const selectedIndex = Math.floor(accountCount / 2)
		const layout = calculateDockLayout({accountCount, selectedIndex, chosen: false})

		expect(layout.sizes).toEqual(Array(accountCount).fill(AVATAR_SIZE))
		expect(layout.gaps).toEqual([...Array(accountCount - 1).fill(DOCK_GAP), 0])
		expect(layout.centers).toHaveLength(accountCount)
		expect(layout.nearestIndexAt(-layout.centers[selectedIndex])).toBe(selectedIndex)
	})

	it('tapers size and spacing away from a chosen account', () => {
		const layout = calculateDockLayout({accountCount: 7, selectedIndex: 3, chosen: true})

		expect(layout.sizes).toEqual([44, 54, 72, 112, 72, 54, 44])
		expect(layout.gaps).toEqual([8, 12, 18, 18, 12, 8, 0])
	})

	it('allows the first and last accounts to sit exactly at center', () => {
		const layout = calculateDockLayout({accountCount: 10, selectedIndex: 4, chosen: true})

		expect(layout.centers[0] + layout.maxX).toBe(0)
		expect(layout.centers[layout.centers.length - 1] + layout.minX).toBe(0)
	})

	it('chooses the account nearest the center of the viewport', () => {
		const layout = calculateDockLayout({accountCount: 3, selectedIndex: 1, chosen: false})

		expect(layout.nearestIndexAt(-layout.centers[0])).toBe(0)
		expect(layout.nearestIndexAt(-layout.centers[1])).toBe(1)
		expect(layout.nearestIndexAt(-layout.centers[2])).toBe(2)
	})
})

describe('arrangeAccounts', () => {
	it.each([2, 3, 12])('keeps the owner selected at dock center for %i accounts', (accountCount) => {
		const arranged = arrangeAccounts(accounts(accountCount))
		const layout = calculateDockLayout({
			accountCount,
			selectedIndex: arranged.ownerIndex,
			chosen: false,
		})
		const stripX = -layout.centers[arranged.ownerIndex]

		expect(arranged.accounts[arranged.ownerIndex].userId).toBe('owner')
		expect(layout.nearestIndexAt(stripX)).toBe(arranged.ownerIndex)
		expect(layout.centers[arranged.ownerIndex] + stripX).toBe(0)
	})
})
