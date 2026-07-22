import {describe, expect, test} from 'vitest'

import {rewriteAppAuthDevProxyPath} from './app-auth.js'

describe('app auth development proxy', () => {
	test.each([
		['/', '/app-auth/'],
		['/?origin=host&app=files', '/app-auth/?origin=host&app=files'],
		['/app-auth', '/app-auth/'],
		['/app-auth?origin=host', '/app-auth/?origin=host'],
		['/app-auth/', '/app-auth/'],
		['/app-auth/?origin=tor', '/app-auth/?origin=tor'],
		['/app-auth/src/app-auth.tsx', '/src/app-auth.tsx'],
		['/app-auth/@vite/client?direct', '/@vite/client?direct'],
		['/src/app-auth.tsx', '/src/app-auth.tsx'],
		['/@vite/client', '/@vite/client'],
	])('rewrites %s to %s', (input, expected) => {
		expect(rewriteAppAuthDevProxyPath(input)).toBe(expected)
	})
})
