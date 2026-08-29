import {useCallback, useMemo, useState} from 'react'

export type Account = {
	userId: string
	name: string
	wallpaper?: {id: string; brandColorHsl: string}
	language?: string
	avatarUrl?: string
}

/** Places the owner in the middle, with members alternating outwards. */
export function arrangeAccounts(rawAccounts: Account[]): {accounts: Account[]; ownerIndex: number} {
	if (rawAccounts.length === 0) return {accounts: [], ownerIndex: 0}

	const [owner, ...members] = rawAccounts
	const left: Account[] = []
	const right: Account[] = []
	members.forEach((member, index) => (index % 2 === 0 ? right : left).push(member))

	return {accounts: [...left.reverse(), owner, ...right], ownerIndex: left.length}
}

export function useAccountPicker(rawAccounts: Account[]) {
	const {accounts, ownerIndex} = useMemo(() => arrangeAccounts(rawAccounts), [rawAccounts])
	const [selectedUserId, setSelectedUserId] = useState<string>()
	const [hoveredUserId, setHoveredUserId] = useState<string>()

	const selectedAccountIndex = accounts.findIndex((account) => account.userId === selectedUserId)
	const hoveredAccountIndex = accounts.findIndex((account) => account.userId === hoveredUserId)
	const selectedIndex = selectedAccountIndex === -1 ? ownerIndex : selectedAccountIndex
	const hoveredIndex = hoveredAccountIndex === -1 ? null : hoveredAccountIndex
	const selectedAccount = accounts[selectedIndex] ?? accounts[0]
	const activeAccount = hoveredIndex === null ? selectedAccount : accounts[hoveredIndex]

	const selectAccount = useCallback(
		(index: number) => {
			const account = accounts[index]
			if (!account) return
			setSelectedUserId(account.userId)
			setHoveredUserId(undefined)
		},
		[accounts],
	)

	const setHoveredIndex = useCallback(
		(index: number | null) => setHoveredUserId(index === null ? undefined : accounts[index]?.userId),
		[accounts],
	)

	return {
		accounts,
		hasMultipleAccounts: accounts.length > 1,
		selectedIndex,
		hoveredIndex,
		selectedAccount,
		activeAccount,
		selectAccount,
		setHoveredIndex,
	}
}
