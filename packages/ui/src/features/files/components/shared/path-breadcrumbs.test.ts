// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {getCrumbs} from './path-breadcrumbs'

const crumbsFor = (path: string) => getCrumbs(path, '/Home', 'Home', 'Apps')

describe('getCrumbs', () => {
	test('walks home paths from a named Home crumb', () => {
		expect(crumbsFor('/Home/Documents/Work')).toEqual([
			{path: '/Home', name: 'Home', type: 'directory'},
			{path: '/Home/Documents', name: 'Documents', type: 'directory'},
			{path: '/Home/Documents/Work', name: 'Work', type: 'directory'},
		])
	})

	test('roots external paths at the drive partition', () => {
		expect(crumbsFor('/External/SSD/Media/Movies')).toEqual([
			{path: '/External/SSD', name: 'SSD', type: 'external-storage'},
			{path: '/External/SSD/Media', name: 'Media', type: 'directory'},
			{path: '/External/SSD/Media/Movies', name: 'Movies', type: 'directory'},
		])
	})

	test('roots network paths at the share, hiding the host segment', () => {
		expect(crumbsFor('/Network/nas/media/TV')).toEqual([
			{path: '/Network/nas/media', name: 'media', type: 'network-share'},
			{path: '/Network/nas/media/TV', name: 'TV', type: 'directory'},
		])
	})

	test('keeps a bare network host path intact', () => {
		expect(crumbsFor('/Network/nas')).toEqual([{path: '/Network/nas', name: 'nas', type: 'network-share'}])
	})

	test('carries app identity for app storage paths', () => {
		expect(crumbsFor('/Apps/jellyfin/data')).toEqual([
			{path: '/Apps', name: 'Apps', type: 'directory'},
			{path: '/Apps/jellyfin', name: 'jellyfin', type: 'directory'},
			{path: '/Apps/jellyfin/data', name: 'data', type: 'directory'},
		])
	})

	test('falls back to plain folder crumbs for unknown roots', () => {
		expect(crumbsFor('/etc/nginx')).toEqual([
			{path: '/etc', name: 'etc', type: 'directory'},
			{path: '/etc/nginx', name: 'nginx', type: 'directory'},
		])
	})
})
