import {describe, expect, it} from 'vitest'

import {normalizeSearchText, rankCmdkEntries, type CmdkEntry} from './cmdk-search'

const noop = () => {}

function entry(id: string, title: string, keywords?: string[]): CmdkEntry {
	return {id, title, keywords, onSelect: noop}
}

const ids = (entries: CmdkEntry[]) => entries.map(({id}) => id)

describe('rankCmdkEntries', () => {
	it('returns nothing for an empty query', () => {
		expect(rankCmdkEntries([entry('a', 'Files')], '   ', 25)).toEqual([])
	})

	it('ranks title matches by tier: exact, prefix, word prefix, substring', () => {
		const entries = [
			entry('substring', 'Profile'),
			entry('word-prefix', 'Wi-Fi'),
			entry('prefix', 'File sharing'),
			entry('exact', 'Fi'),
		]

		expect(ids(rankCmdkEntries(entries, 'fi', 25))).toEqual(['exact', 'prefix', 'word-prefix', 'substring'])
	})

	it('treats punctuation and brackets as word boundaries', () => {
		const entries = [entry('substring', 'Simcp'), entry('word-prefix', 'AI agents (MCP)')]

		expect(ids(rankCmdkEntries(entries, 'mcp', 25))).toEqual(['word-prefix', 'substring'])
		expect(ids(rankCmdkEntries(entries, '(mcp)', 25))).toEqual(['word-prefix'])
	})

	it('ranks any title match above keyword matches, and keyword prefixes above substrings', () => {
		const entries = [
			entry('keyword-substring', 'Advanced settings', ['Discover devices with mDNS']),
			entry('keyword-prefix', 'Network', ['DNS server']),
			entry('title', 'External DNS'),
		]

		expect(ids(rankCmdkEntries(entries, 'dns', 25))).toEqual(['title', 'keyword-prefix', 'keyword-substring'])
	})

	it('keeps entry order within a tier', () => {
		const entries = [entry('first', 'Backups'), entry('second', 'Backrest'), entry('third', 'Backdrop')]

		expect(ids(rankCmdkEntries(entries, 'back', 25))).toEqual(['first', 'second', 'third'])
	})

	it('matches compact queries against titles as a last resort', () => {
		const entries = [entry('password', 'Change password'), entry('name', 'Change name')]

		expect(ids(rankCmdkEntries(entries, 'chpass', 25))).toEqual(['password'])
		// Too short to be meaningful as a subsequence
		expect(ids(rankCmdkEntries(entries, 'cp', 25))).toEqual([])
	})

	it('ignores accents and case in both the query and the entries', () => {
		const entries = [entry('advanced', 'Advanced settings', ['Nom d’hôte sécurisé'])]

		expect(ids(rankCmdkEntries(entries, 'hote securise', 25))).toEqual(['advanced'])
		expect(ids(rankCmdkEntries(entries, 'HÔTE', 25))).toEqual(['advanced'])
	})

	it('caps the number of results after ranking, so the best match is never cut off', () => {
		const entries = [...Array.from({length: 40}, (_, i) => entry(`app-${i}`, `Webapp ${i}`)), entry('exact', 'App')]

		const results = ids(rankCmdkEntries(entries, 'app', 25))
		expect(results).toHaveLength(25)
		expect(results[0]).toBe('exact')
	})
})

describe('normalizeSearchText', () => {
	it('lowercases, trims, and strips accents', () => {
		expect(normalizeSearchText('  Nom d’hôte Sécurisé ')).toBe('nom d’hote securise')
	})
})
