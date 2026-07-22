import assert from 'node:assert/strict'
import test from 'node:test'

import {authorizedUrlState, withHttpApiToken} from './authorized-url.ts'

test('does not request authorization for an absent resource URL', () => {
	assert.deepEqual(authorizedUrlState(undefined, undefined, true), {status: 'idle', url: undefined})
})

test('distinguishes loading and failed HTTP URL authorization', () => {
	assert.deepEqual(authorizedUrlState('/api/files/view?path=%2FHome%2Fphoto.jpg', undefined, false), {
		status: 'loading',
		url: undefined,
	})
	assert.deepEqual(authorizedUrlState('/api/files/view?path=%2FHome%2Fphoto.jpg', undefined, true), {
		status: 'error',
		url: undefined,
	})
})

test('constructs a ready URL and keeps stale token data usable after a background error', () => {
	const expected = '/api/files/view?path=%2FHome%2Fphoto.jpg&token=session%20file%20token'
	assert.equal(withHttpApiToken('/api/files/view?path=%2FHome%2Fphoto.jpg', 'session file token'), expected)
	assert.deepEqual(authorizedUrlState('/api/files/view?path=%2FHome%2Fphoto.jpg', 'session file token', true), {
		status: 'ready',
		url: expected,
	})
})
