import type {ReactNode} from 'react'

// A command palette row. Sources (apps, settings, machines…) produce these and
// `rankCmdkEntries` picks the ones to show for a query. Matching happens here,
// in plain JS, so cmdk itself never scores anything: it only receives the
// already-ranked rows and handles keyboard navigation and selection.
export type CmdkEntry = {
	// Unique across every source, prefixed by the source: 'app:bitcoin', 'settings:wifi'
	id: string
	title: string
	// Dimmed text after the title, e.g. "in Settings"
	subtitle?: string
	// Extra copy the entry should be found by: descriptions, aliases, nested settings copy
	keywords?: string[]
	// Shown without a query, in source order
	default?: boolean
	// Rendered but not selectable, e.g. an app that is still installing
	disabled?: boolean
	icon?: string | ReactNode
	onSelect?: () => void
}

export function normalizeSearchText(value: string) {
	return value
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
}

// Match tiers, best first. Ties keep entry order, so sources are listed by
// priority (system actions, settings, installed apps, shortcuts, app store).
function scoreEntry(entry: CmdkEntry, query: string, wordStart: RegExp) {
	const title = normalizeSearchText(entry.title)
	if (title === query) return 7
	if (title.startsWith(query)) return 6
	if (wordStart.test(title)) return 5
	if (title.includes(query)) return 4

	const keywords = entry.keywords?.map(normalizeSearchText) ?? []
	if (keywords.some((keyword) => wordStart.test(keyword))) return 3
	if (keywords.some((keyword) => keyword.includes(query))) return 2

	// Compact queries like "chpass" → "Change password". Only for titles and
	// only from three characters, otherwise everything matches.
	if (query.length >= 3 && isSubsequence(query, title)) return 1
	return 0
}

function isSubsequence(query: string, text: string) {
	let matched = 0
	for (let i = 0; i < text.length && matched < query.length; i++) {
		if (text[i] === query[matched]) matched++
	}
	return matched === query.length
}

export function rankCmdkEntries(entries: CmdkEntry[], query: string, limit: number): CmdkEntry[] {
	const normalizedQuery = normalizeSearchText(query)
	if (!normalizedQuery) return []

	// The query at the start of a word: "fi" in "Wi-Fi", "mcp" in "AI agents (MCP)"
	const wordStart = new RegExp(`(?:^|[^\\p{L}\\p{N}])${normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u')

	return entries
		.map((entry) => ({entry, score: scoreEntry(entry, normalizedQuery, wordStart)}))
		.filter(({score}) => score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({entry}) => entry)
}
