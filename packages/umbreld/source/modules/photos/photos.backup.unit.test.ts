import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import Umbreld from '../../index.js'
import temporaryDirectory from '../utilities/temporary-directory.js'

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'

describe('Photos backup storage', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let dataDirectory: string
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		dataDirectory = await directory.create()
		umbreld = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
	})

	afterEach(async () => {
		await directory.destroyRoot()
	})

	test('keeps durable backup source identity separate from managed media', async () => {
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID.toUpperCase(),
			suggestedName: '  Pixel 9  ',
		})

		expect(source).toMatchObject({id: SOURCE_ID, accountId: '0', name: 'Pixel 9'})
		expect(source.createdAt).toBeTypeOf('number')
		expect(await umbreld.store.get('photos.backupSources')).toEqual([source])
		expect(umbreld.photos.backupSourceMediaDirectory(source)).toBe(`${dataDirectory}/photos/media/0/${SOURCE_ID}`)
		await expect(fse.pathExists(umbreld.photos.backupSourceMediaDirectory(source))).resolves.toBe(true)
		await expect(fse.pathExists(`${dataDirectory}/home/Photos`)).resolves.toBe(false)
	})

	test('preserves the first backup source registration across retries and restarts', async () => {
		const original = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Pixel 9',
		})
		const retry = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Renamed phone',
		})
		expect(retry).toEqual(original)

		await fse.remove(umbreld.photos.backupSourceMediaDirectory(original))
		const restarted = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
		await expect(
			restarted.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: 'Another name'}),
		).resolves.toEqual(original)
		await expect(fse.pathExists(restarted.photos.backupSourceMediaDirectory(original))).resolves.toBe(true)
	})

	test('scopes the same client source id independently to each account', async () => {
		const owner = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const member = await umbreld.photos.registerBackupSource({
			accountId: 'Alice',
			sourceId: SOURCE_ID,
			suggestedName: 'Alice phone',
		})

		expect(member).toMatchObject({id: SOURCE_ID, accountId: 'Alice', name: 'Alice phone'})
		expect(umbreld.photos.backupSourceMediaDirectory(member)).not.toBe(umbreld.photos.backupSourceMediaDirectory(owner))
	})

	test('confirms only complete regular resources in the requested account and source', async () => {
		const owner = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const member = await umbreld.photos.registerBackupSource({
			accountId: 'Alice',
			sourceId: SOURCE_ID,
			suggestedName: 'Alice phone',
		})
		const confirmedKey = 'a'.repeat(64)
		const otherAccountKey = 'b'.repeat(64)
		const directoryKey = 'c'.repeat(64)
		const partialKey = 'd'.repeat(64)
		await fse.writeFile(`${umbreld.photos.backupSourceMediaDirectory(owner)}/${confirmedKey}.heic`, 'photo')
		await fse.writeFile(`${umbreld.photos.backupSourceMediaDirectory(member)}/${otherAccountKey}.heic`, 'private')
		await fse.ensureDir(`${umbreld.photos.backupSourceMediaDirectory(owner)}/${directoryKey}.heic`)
		await fse.writeFile(
			`${umbreld.photos.backupSourceMediaDirectory(owner)}/.${partialKey}.heic.uploading.umbrel-upload`,
			'partial',
		)

		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: '0',
				sourceId: SOURCE_ID,
				resources: [
					{resourceKey: confirmedKey, fileExtension: 'heic'},
					{resourceKey: otherAccountKey, fileExtension: 'heic'},
					{resourceKey: directoryKey, fileExtension: 'heic'},
					{resourceKey: partialKey, fileExtension: 'heic'},
				],
			}),
		).resolves.toEqual([{resourceKey: confirmedKey, path: `${SOURCE_ID}/${confirmedKey}.heic`, bytes: 5}])
		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: 'Bob',
				sourceId: SOURCE_ID,
				resources: [{resourceKey: confirmedKey, fileExtension: 'heic'}],
			}),
		).resolves.toEqual([])
	})

	test('deletes one account without leaving media or backup source records', async () => {
		const owner = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const member = await umbreld.photos.registerBackupSource({
			accountId: 'Alice',
			sourceId: SOURCE_ID,
			suggestedName: 'Alice phone',
		})
		const ownerMedia = `${umbreld.photos.backupSourceMediaDirectory(owner)}/photo.jpg`
		const memberMedia = `${umbreld.photos.backupSourceMediaDirectory(member)}/photo.jpg`
		await fse.writeFile(ownerMedia, 'owner')
		await fse.writeFile(memberMedia, 'member')

		await umbreld.photos.deleteAccount('Alice')
		await expect(umbreld.photos.deleteAccount('Alice')).resolves.toBeUndefined()

		await expect(fse.pathExists(ownerMedia)).resolves.toBe(true)
		await expect(fse.pathExists(memberMedia)).resolves.toBe(false)
		await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([owner])
		await expect(
			umbreld.photos.registerBackupSource({
				accountId: 'Alice',
				sourceId: SOURCE_ID,
				suggestedName: 'New registration',
			}),
		).resolves.toMatchObject({name: 'New registration'})
	})

	test('rejects path-like identities before deriving storage paths', async () => {
		await expect(
			umbreld.photos.registerBackupSource({accountId: '../Alice', sourceId: SOURCE_ID, suggestedName: 'Phone'}),
		).rejects.toThrow('Invalid Photos account id')
		await expect(
			umbreld.photos.registerBackupSource({accountId: '0', sourceId: '../phone', suggestedName: 'Phone'}),
		).rejects.toThrow('Invalid photo backup source id')
		await expect(
			umbreld.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: ' '}),
		).rejects.toThrow('Invalid photo backup source name')
		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: '0',
				sourceId: SOURCE_ID,
				resources: [{resourceKey: 'not-a-key', fileExtension: 'heic'}],
			}),
		).rejects.toThrow('Invalid photo backup resource')
	})
})
