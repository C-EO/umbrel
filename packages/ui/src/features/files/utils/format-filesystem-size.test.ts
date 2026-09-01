import {describe, expect, test} from 'vitest'

import {formatFilesystemSize} from './format-filesystem-size'

describe('formatFilesystemSize', () => {
	test('distinguishes unknown sizes from known zero-byte sizes', () => {
		expect(formatFilesystemSize(undefined)).toBe('-')
		expect(formatFilesystemSize(null)).toBe('-')
		expect(formatFilesystemSize(0)).toBe('0 KB')
	})

	test('formats non-zero sizes as before', () => {
		expect(formatFilesystemSize(1_000)).toBe('1 KB')
	})
})
