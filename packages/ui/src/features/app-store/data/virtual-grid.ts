// Pure layout math for the virtualized app grid: uniform rows of a fixed
// column count, sitting somewhere inside a scroll parent that also holds other
// content above and below. Kept free of React and the DOM so it can be
// unit-tested and reasoned about on its own.

export type GridLayout = {
	/** Cards per row */
	columns: number
	/** Height of one row of cards, px */
	rowHeight: number
	/** Vertical space between rows, px */
	gap: number
	/** Number of rows */
	rows: number
	/** Distance from one row's top to the next, px */
	pitch: number
	/** Height of the whole grid, px — no trailing gap after the last row */
	total: number
}

export function buildGridLayout({
	count,
	columns,
	rowHeight,
	gap,
}: {
	count: number
	columns: number
	rowHeight: number
	gap: number
}): GridLayout {
	const cols = Math.max(1, Math.floor(columns))
	const rows = Math.ceil(Math.max(0, count) / cols)
	const pitch = rowHeight + gap
	return {columns: cols, rowHeight, gap, rows, pitch, total: rows === 0 ? 0 : rows * pitch - gap}
}

export function rowTop(layout: GridLayout, row: number): number {
	return row * layout.pitch
}

/** Inclusive row indexes; `end < start` means nothing is in view */
export type RowRange = {start: number; end: number}

export const EMPTY_RANGE: RowRange = {start: 0, end: -1}

export function sameRange(a: RowRange, b: RowRange): boolean {
	return a.start === b.start && a.end === b.end
}

/**
 * The rows intersecting the scroll parent's viewport, extended by `overscan`
 * px on each side. `offset` is where the grid starts within the parent's
 * scrollable content, so the grid can sit below any amount of other content.
 */
export function visibleRowRange(
	layout: GridLayout,
	{offset, scrollTop, viewport, overscan}: {offset: number; scrollTop: number; viewport: number; overscan: number},
): RowRange {
	if (layout.rows === 0) return EMPTY_RANGE
	// The window in grid coordinates
	const from = scrollTop - offset - overscan
	const to = scrollTop - offset + viewport + overscan
	// First row whose bottom edge is below `from`; last row whose top is above `to`
	const start = Math.max(0, Math.floor((from - layout.rowHeight) / layout.pitch) + 1)
	const end = Math.min(layout.rows - 1, Math.ceil(to / layout.pitch) - 1)
	return end < start ? EMPTY_RANGE : {start, end}
}

/**
 * Column count of a laid-out grid container, from the resolved value of its
 * `grid-template-columns`: every track serialized as a length ("312px 312px
 * 312px"), line names in brackets, or `none` when the grid declares no
 * explicit tracks and lays its items out in one implicit column.
 */
export function countGridColumns(gridTemplateColumns: string): number {
	const tracks = gridTemplateColumns.split(/\s+/).filter((token) => /^-?\d*\.?\d+px$/.test(token))
	return Math.max(1, tracks.length)
}
