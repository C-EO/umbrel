export const AVATAR_SIZE = 112
export const DOCK_GAP = 18

type CalculateDockLayoutOptions = {
	accountCount: number
	selectedIndex: number
	chosen: boolean
}

export type DockLayout = {
	centers: number[]
	sizes: number[]
	gaps: number[]
	minX: number
	maxX: number
	nearestIndexAt: (stripX: number) => number
}

function avatarSize(distance: number, chosen: boolean): number {
	if (!chosen || distance === 0) return AVATAR_SIZE
	if (distance === 1) return 72
	if (distance === 2) return 54
	return 44
}

function gapAfter(index: number, accountCount: number, selectedIndex: number, chosen: boolean): number {
	if (index >= accountCount - 1) return 0
	if (!chosen) return DOCK_GAP

	const distance = Math.max(Math.abs(index - selectedIndex), Math.abs(index + 1 - selectedIndex))
	if (distance <= 1) return DOCK_GAP
	if (distance === 2) return 12
	return 8
}

export function calculateDockLayout({accountCount, selectedIndex, chosen}: CalculateDockLayoutOptions): DockLayout {
	const count = Math.max(0, accountCount)
	const selected = Math.min(Math.max(0, selectedIndex), Math.max(0, count - 1))
	const sizes = Array.from({length: count}, (_, index) => avatarSize(Math.abs(index - selected), chosen))
	const gaps = Array.from({length: count}, (_, index) => gapAfter(index, count, selected, chosen))
	const centers: number[] = []

	let x = 0
	for (let index = 0; index < count; index += 1) {
		centers.push(x + sizes[index] / 2)
		x += sizes[index] + gaps[index]
	}

	const nearestIndexAt = (stripX: number): number => {
		let nearest = 0
		for (let index = 1; index < centers.length; index += 1) {
			if (Math.abs(centers[index] + stripX) < Math.abs(centers[nearest] + stripX)) nearest = index
		}
		return nearest
	}

	return {
		centers,
		sizes,
		gaps,
		minX: centers.length ? -centers[centers.length - 1] : 0,
		maxX: centers.length ? -centers[0] : 0,
		nearestIndexAt,
	}
}
