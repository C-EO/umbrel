// The moment a photo was taken, as a wall clock. When the file carried its
// capture-time UTC offset (EXIF OffsetTimeOriginal → Item.takenAtOffsetMinutes)
// the clock is the one the camera showed — shifting the epoch by the offset
// and formatting in UTC reads it out exactly, whatever zone the browser is
// in. Without an offset the backend interprets the wall clock as UTC, so the
// viewer does the same and stays consistent with timeline/search grouping.
export function takenAtClock(epochMs: number, offsetMinutes: number | undefined) {
	if (offsetMinutes === undefined) return {date: new Date(epochMs), timeZone: 'UTC' as const, gmt: undefined}
	return {
		date: new Date(epochMs + offsetMinutes * 60_000),
		timeZone: 'UTC' as const,
		gmt: formatGmtOffset(offsetMinutes),
	}
}

// "GMT+9", "GMT-7", "GMT+5:30"
export function formatGmtOffset(minutes: number) {
	const sign = minutes < 0 ? '-' : '+'
	const abs = Math.abs(minutes)
	const rest = abs % 60
	return `GMT${sign}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}
