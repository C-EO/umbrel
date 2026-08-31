import nodePath from 'node:path'
import {createHash} from 'node:crypto'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import AdmZip from 'adm-zip'
import fse from 'fs-extra'
import got from 'got'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

type BrowserSession = {token: string; cookies: string[]}

describe('Photos account isolation', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ownerSession: BrowserSession
	let memberSession: BrowserSession
	let memberId: string
	let ownerItemId: string
	let sharedOwnerItemId: string
	let watchedItemId: string
	let memberItemId: string
	let memberPrivateItemId: string
	let failed = false

	const ownerPassword = 'moneyprintergobrrr'
	const memberPassword = 'passwordpassword'
	const fixturePath = nodePath.resolve(__dirname, '../files/fixtures/thumbnails/master-lossless-image.png')
	let image: Buffer
	let ownerImage: Buffer
	let watchedImage: Buffer
	let interruptedImage: Buffer
	let memberPrivateImage: Buffer
	let memberWatchedImage: Buffer

	function trpcData<T>(body: unknown) {
		return (body as {result?: {data?: T}}).result?.data as T
	}

	async function login(credentials: {userId?: string; password: string}) {
		const response = await got.post(`http://localhost:${umbreld.vm.httpPort}/trpc/user.login`, {
			json: credentials,
			responseType: 'json',
			retry: {limit: 0},
		})
		return {token: trpcData<string>(response.body), cookies: response.headers['set-cookie'] ?? []}
	}

	async function useSession(session: BrowserSession) {
		await umbreld.setBrowserSession(session.token, session.cookies)
	}

	async function getPhotosMedia(path: string) {
		const token = await umbreld.client.user.getHttpApiToken.query()
		const url = new URL(`http://umbrel.local/${path}`)
		url.searchParams.set('token', token)
		return umbreld.browserApi.get(`${url.pathname.replace(/^\/api\//, '')}${url.search}`, {
			responseType: 'buffer',
			throwHttpErrors: false,
		})
	}

	async function upload(name: string, body = image) {
		return umbreld.api.post(`photos/upload?name=${encodeURIComponent(name)}`, {
			body,
			responseType: 'json',
		})
	}

	async function downloadTicket(ids: string[]) {
		return (await umbreld.client.photos.items.createDownload.mutate({ids})).ticket
	}

	async function waitForReady() {
		await pRetry(
			async () => expect(await umbreld.client.photos.library.status.query()).toMatchObject({phase: 'ready'}),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	}

	async function photoItemNamed(name: string) {
		return pRetry(
			async () => {
				const page = await umbreld.client.photos.items.list.query({filter: {query: name}, limit: 10})
				expect(page.total).toBe(1)
				return page.items[0]!
			},
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	}

	beforeAll(async () => {
		image = await fse.readFile(fixturePath)
		// PNG decoders ignore trailing application bytes, while BLAKE3 still gives
		// each fixture a distinct logical identity. The unmodified image is reused
		// deliberately for the one cross-account same-content case.
		ownerImage = Buffer.concat([image, Buffer.from('owner-private')])
		watchedImage = Buffer.concat([image, Buffer.from('owner-watched')])
		interruptedImage = Buffer.concat([image, Buffer.from('interrupted-delete')])
		memberPrivateImage = Buffer.concat([image, Buffer.from('member-private')])
		memberWatchedImage = Buffer.concat([image, Buffer.from('member-watched')])
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.signup()
		ownerSession = await login({password: ownerPassword})
		await useSession(ownerSession)
		const member = await umbreld.client.user.createUser.mutate({name: 'photo-member', password: memberPassword})
		memberId = member.userId
		memberSession = await login({userId: memberId, password: memberPassword})
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('requires authentication for Photos RPC and media endpoints', async () => {
		await expect(umbreld.unauthenticatedClient.photos.library.summary.query()).rejects.toThrow()
		const response = await umbreld.unauthenticatedApi.get('photos/original/unknown', {
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(401)
	})

	test('indexes the owner library and serves its original and thumbnail', async () => {
		await useSession(ownerSession)
		await expect(upload('owner-photo.png', ownerImage)).resolves.toMatchObject({body: {status: 'imported'}})
		await waitForReady()

		const page = await umbreld.client.photos.items.list.query({filter: {}, limit: 10})
		expect(page.total).toBe(1)
		ownerItemId = page.items[0]!.id
		await expect(umbreld.client.photos.items.get.query({id: ownerItemId})).resolves.toMatchObject({
			id: ownerItemId,
			path: '/Home/Photos/owner-photo.png',
		})

		const original = await getPhotosMedia(`api/photos/original/${ownerItemId}`)
		expect(original.statusCode).toBe(200)
		expect(original.body).toEqual(ownerImage)
		for (const size of [192, 512, 1280]) {
			const thumbnail = await getPhotosMedia(`api/photos/thumb/${ownerItemId}?s=${size}`)
			expect(thumbnail.statusCode).toBe(200)
			expect(thumbnail.headers['content-type']).toBe('image/webp')
			expect(thumbnail.body.length).toBeGreaterThan(0)
		}
	})

	test('serves every Photos rendition with oriented short-edge sizing and no upscaling', async () => {
		await useSession(ownerSession)
		const directory = `${umbreld.vm.dataDirectory}/home/Photos/short-edge-renditions`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${directory}'
			convert -size 3000x2000 xc:red '${directory}/shortedge-landscape.png'
			convert -size 2000x3000 xc:blue '${directory}/shortedge-portrait.png'
			convert -size 2000x2000 xc:yellow '${directory}/shortedge-square.png'
			convert -size 100x50 xc:purple '${directory}/shortedge-small.png'
			convert -size 4000x1000 xc:orange '${directory}/shortedge-panorama.png'
			convert -size 3000x2000 xc:green '${directory}/shortedge-orientation-base.jpg'
			node -e '
				const fs = require("node:fs")
				const source = fs.readFileSync("${directory}/shortedge-orientation-base.jpg")
				const payload = Buffer.alloc(32)
				payload.write("Exif\\0\\0", 0, "binary")
				payload.write("II", 6, "ascii")
				payload.writeUInt16LE(42, 8)
				payload.writeUInt32LE(8, 10)
				payload.writeUInt16LE(1, 14)
				payload.writeUInt16LE(0x0112, 16)
				payload.writeUInt16LE(3, 18)
				payload.writeUInt32LE(1, 20)
				payload.writeUInt16LE(6, 24)
				payload.writeUInt32LE(0, 28)
				const segment = Buffer.alloc(4 + payload.length)
				segment.writeUInt16BE(0xffe1, 0)
				segment.writeUInt16BE(payload.length + 2, 2)
				payload.copy(segment, 4)
				fs.writeFileSync(
					"${directory}/shortedge-rotated.jpg",
					Buffer.concat([source.subarray(0, 2), segment, source.subarray(2)]),
				)
				fs.unlinkSync("${directory}/shortedge-orientation-base.jpg")
			'
		`)
		await photoItemNamed('shortedge-landscape')
		await waitForReady()

		const expectations: Record<string, Record<number, string>> = {
			'shortedge-landscape': {192: '288x192', 512: '768x512', 1280: '1920x1280'},
			'shortedge-portrait': {192: '192x288', 512: '512x768', 1280: '1280x1920'},
			'shortedge-square': {192: '192x192', 512: '512x512', 1280: '1280x1280'},
			'shortedge-small': {192: '100x50', 512: '100x50', 1280: '100x50'},
			'shortedge-panorama': {192: '768x192', 512: '2048x512', 1280: '4000x1000'},
			'shortedge-rotated': {192: '192x288', 512: '512x768', 1280: '1280x1920'},
		}
		const variants = {
			192: 'preview-192-webp-v1',
			512: 'preview-512-webp-v2',
			1280: 'preview-1280-webp-v2',
		} as const
		for (const [name, dimensions] of Object.entries(expectations)) {
			const item = await photoItemNamed(name)
			expect(item.id).toMatch(/^[a-f0-9]{64}$/)
			for (const size of [192, 512, 1280] as const) {
				const response = await getPhotosMedia(`api/photos/thumb/${item.id}?s=${size}`)
				expect(response.statusCode).toBe(200)
				const artifact = `${umbreld.vm.dataDirectory}/thumbnails/content/${variants[size]}/${item.id.slice(0, 2)}/${item.id}.webp`
				await expect(umbreld.vm.sshAsRoot(`identify -quiet -format '%wx%h' '${artifact}[0]'`)).resolves.toBe(
					dimensions[size],
				)
			}
		}
	})

	test('discovers Files changes, applies source scope, and preserves ids across moves', async () => {
		await useSession(ownerSession)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent('/Home/Camera/watched-photo.png')}`, {
			body: watchedImage,
		})
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.list.query({filter: {}, limit: 10})).toMatchObject({total: 8}),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		await waitForReady()
		const watched = await umbreld.client.photos.items.list.query({filter: {query: 'watched-photo'}, limit: 10})
		expect(watched.total).toBe(1)
		watchedItemId = watched.items[0]!.id

		const source = (await umbreld.client.photos.sources.list.query()).find(({type}) => type === 'umbrel')!
		await umbreld.client.photos.sources.update.mutate({
			id: source.id,
			scope: {mode: 'only', paths: ['/Home/Photos']},
		})
		await expect(umbreld.client.photos.items.list.query({filter: {}, limit: 10})).resolves.toMatchObject({total: 7})
		await expect(umbreld.client.photos.items.get.query({id: watchedItemId})).rejects.toThrow()
		await umbreld.client.photos.sources.update.mutate({id: source.id, scope: {mode: 'everything', paths: []}})
		await expect(umbreld.client.photos.items.list.query({filter: {}, limit: 10})).resolves.toMatchObject({total: 8})

		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/Camera/watched-photo.png', newName: 'renamed-photo.png'}),
		).resolves.toBe('/Home/Camera/renamed-photo.png')
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.get.query({id: watchedItemId})).toMatchObject({
					path: '/Home/Camera/renamed-photo.png',
				}),
			{retries: 120, factor: 1, minTimeout: 100, maxTimeout: 100},
		)

		const archive = await getPhotosMedia(
			`api/photos/download?ticket=${encodeURIComponent(await downloadTicket([ownerItemId, watchedItemId]))}`,
		)
		expect(archive.statusCode).toBe(200)
		expect(archive.headers['content-type']).toBe('application/zip')
		const downloaded = Object.fromEntries(
			new AdmZip(archive.body).getEntries().map((entry) => [entry.entryName, entry.getData()]),
		)
		expect(downloaded['owner-photo.png']).toEqual(ownerImage)
		expect(downloaded['renamed-photo.png']).toEqual(watchedImage)
	})

	test('safely completes or recovers a power-interrupted permanent deletion', async () => {
		await useSession(ownerSession)
		const virtualPath = '/Home/Camera/interrupted-delete.png'
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(virtualPath)}`, {body: interruptedImage})
		const interrupted = await pRetry(
			async () => {
				const page = await umbreld.client.photos.items.list.query({
					filter: {query: 'interrupted-delete'},
					limit: 10,
				})
				expect(page.total).toBe(1)
				return page.items[0]!
			},
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		await umbreld.client.photos.items.delete.mutate({ids: [interrupted.id]})
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')

		// Emulate power stopping after the durable claim journal and atomic rename,
		// but before validation/final movement into Files Trash. Stop umbreld first
		// so the externally injected partial operation cannot race with ordinary
		// watcher/index work before the VM is powered off.
		const systemPath = `${umbreld.vm.dataDirectory}/home/Camera/interrupted-delete.png`
		const claimId = createHash('sha256').update(systemPath).digest('hex').slice(0, 32)
		const claimSystemPath = `${umbreld.vm.dataDirectory}/home/Camera/.${claimId}.umbrel-trash`
		const manifestSystemPath = `${umbreld.vm.dataDirectory}/home/Camera/.${claimId}.json.umbrel-trash`
		await umbreld.vm.sshAsRoot(`node -e '
			const fs = require("node:fs")
			const path = require("node:path")
			const original = ${JSON.stringify(systemPath)}
			const claim = ${JSON.stringify(claimSystemPath)}
			const manifest = ${JSON.stringify(manifestSystemPath)}
			const temporary = manifest + ".tmp.umbrel-trash"
			const stats = fs.lstatSync(original, {bigint: true})
			const value = JSON.stringify({
				version: 1,
				originalSystemPath: original,
				revision: {
					inode: stats.ino.toString(),
					size: Number(stats.size),
					modifiedNs: stats.mtimeNs.toString(),
					ctimeNs: stats.ctimeNs.toString(),
				},
			})
			const file = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
			fs.writeFileSync(file, value)
			fs.fsyncSync(file)
			fs.closeSync(file)
			fs.linkSync(temporary, manifest)
			fs.unlinkSync(temporary)
			let directory = fs.openSync(path.dirname(original), fs.constants.O_RDONLY)
			fs.fsyncSync(directory)
			fs.closeSync(directory)
			fs.renameSync(original, claim)
			directory = fs.openSync(path.dirname(original), fs.constants.O_RDONLY)
			fs.fsyncSync(directory)
			fs.closeSync(directory)
		'`)
		await expect(
			umbreld.vm.sshAsRoot(
				`test ! -e '${systemPath}' && test -f '${claimSystemPath}' && test -f '${manifestSystemPath}'`,
			),
		).resolves.toBe('')
		await umbreld.vm.forcePowerOff()
		await umbreld.vm.powerOn()
		ownerSession = await login({password: ownerPassword})
		memberSession = await login({userId: memberId, password: memberPassword})
		await useSession(ownerSession)
		await waitForReady()

		try {
			// Journal replay may leave either side of the atomic rename durable. If
			// the original pathname survived, the first attempt can finish normally.
			// If the hidden claim survived, Files restores it and asks Photos to retry
			// while its durable row still exists.
			const changes = await umbreld.client.photos.items.deletePermanently.mutate({ids: [interrupted.id]})
			expect(changes).toBeGreaterThan(0)
		} catch (error) {
			expect(error).toHaveProperty('message', expect.stringContaining('[trash-claim-recovered]'))
			await expect(umbreld.vm.ssh(`sha256sum '${systemPath}' | cut -d ' ' -f 1 | tr -d '\\n'`)).resolves.toBe(
				createHash('sha256').update(interruptedImage).digest('hex'),
			)
			await pRetry(
				async () => {
					const page = await umbreld.client.photos.items.list.query({
						filter: {deleted: true, query: 'interrupted-delete'},
						limit: 10,
					})
					expect(page).toMatchObject({total: 1})
					expect(page.items[0]).toMatchObject({id: interrupted.id})
				},
				{retries: 120, factor: 1, minTimeout: 100, maxTimeout: 100},
			)
			await pRetry(
				async () =>
					expect(await umbreld.client.photos.items.deletePermanently.mutate({ids: [interrupted.id]})).toBeGreaterThan(
						0,
					),
				{retries: 120, factor: 1, minTimeout: 100, maxTimeout: 100},
			)
		}
		await expect(
			umbreld.vm.ssh(
				`sha256sum '${umbreld.vm.dataDirectory}/trash/interrupted-delete.png' | cut -d ' ' -f 1 | tr -d '\\n'`,
			),
		).resolves.toBe(createHash('sha256').update(interruptedImage).digest('hex'))
		await expect(
			umbreld.vm.sshAsRoot(`test ! -e '${claimSystemPath}' && test ! -e '${manifestSystemPath}'`),
		).resolves.toBe('')
		await expect(
			umbreld.client.photos.items.list.query({filter: {deleted: true, query: 'interrupted-delete'}, limit: 10}),
		).resolves.toMatchObject({total: 0})
	})

	test('uses one hash identity across accounts without sharing locations or state', async () => {
		await useSession(ownerSession)
		await expect(upload('owner-shared.png')).resolves.toMatchObject({body: {status: 'imported'}})
		sharedOwnerItemId = (await photoItemNamed('owner-shared')).id

		await useSession(memberSession)
		await expect(upload('member-photo.png')).resolves.toMatchObject({body: {status: 'imported'}})
		await waitForReady()

		const page = await umbreld.client.photos.items.list.query({filter: {}, limit: 10})
		expect(page.total).toBe(1)
		memberItemId = page.items[0]!.id
		expect(memberItemId).toBe(sharedOwnerItemId)
		await expect(umbreld.client.photos.items.get.query({id: memberItemId})).resolves.toMatchObject({
			id: memberItemId,
			path: `/Users/${memberId}/Photos/member-photo.png`,
		})
		await expect(umbreld.client.photos.items.get.query({id: ownerItemId})).rejects.toThrow()

		// Supplying a guessed owner-only hash cannot smuggle it into a member
		// album, while the shared hash is authorized through the member location.
		const album = await umbreld.client.photos.albums.create.mutate({
			name: 'Member album',
			ids: [ownerItemId, memberItemId],
		})
		expect(album).toMatchObject({count: 1, coverId: memberItemId})

		// Dedupe is account-local: the first member copy imported above, while a
		// second member copy is recognized without creating another library item.
		await expect(upload('member-duplicate.png')).resolves.toMatchObject({body: {status: 'duplicate'}})
		await expect(umbreld.client.photos.items.list.query({filter: {}, limit: 10})).resolves.toMatchObject({total: 1})
		await expect(upload('member-private.png', memberPrivateImage)).resolves.toMatchObject({body: {status: 'imported'}})
		memberPrivateItemId = (await photoItemNamed('member-private')).id
		expect(memberPrivateItemId).not.toBe(memberItemId)

		// The member's independently-watched Home root feeds Photos too; this is
		// not limited to uploads made through the Photos screen.
		const watchedPath = `/Users/${memberId}/Camera/files-photo.png`
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(watchedPath)}`, {body: memberWatchedImage})
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.list.query({filter: {query: 'files-photo'}, limit: 10})).toMatchObject(
					{
						total: 1,
					},
				),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		const watched = await umbreld.client.photos.items.list.query({filter: {query: 'files-photo'}, limit: 10})
		await expect(umbreld.client.photos.items.get.query({id: watched.items[0]!.id})).resolves.toMatchObject({
			path: watchedPath,
		})
		await umbreld.client.files.trash.mutate({path: watchedPath})
		await pRetry(
			async () =>
				expect(await umbreld.client.photos.items.list.query({filter: {query: 'files-photo'}, limit: 10})).toMatchObject(
					{
						total: 0,
					},
				),
			{retries: 240, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	})

	test('does not serve another account original or content-addressed thumbnail', async () => {
		await useSession(ownerSession)
		const ownerDownloadTicket = await downloadTicket([ownerItemId])
		await useSession(memberSession)
		await expect(downloadTicket([ownerItemId])).rejects.toThrow()
		for (const path of [
			`api/photos/original/${ownerItemId}`,
			...([192, 512, 1280] as const).map((size) => `api/photos/thumb/${ownerItemId}?s=${size}`),
			`api/photos/live/${ownerItemId}`,
			`api/photos/download?ticket=${encodeURIComponent(ownerDownloadTicket)}`,
		]) {
			expect((await getPhotosMedia(path)).statusCode).toBe(404)
		}
		// A same-hash id resolves through this account's own location, never the
		// canonical path selected for another account.
		expect((await getPhotosMedia(`api/photos/original/${memberItemId}`)).body).toEqual(image)
		for (const size of [192, 512, 1280]) {
			expect((await getPhotosMedia(`api/photos/thumb/${memberItemId}?s=${size}`)).statusCode).toBe(200)
		}

		await useSession(ownerSession)
		await expect(umbreld.client.photos.items.get.query({id: memberItemId})).resolves.toMatchObject({
			id: memberItemId,
			path: '/Home/Photos/owner-shared.png',
		})
		expect((await getPhotosMedia(`api/photos/original/${memberPrivateItemId}`)).statusCode).toBe(404)
		for (const size of [192, 512, 1280]) {
			expect((await getPhotosMedia(`api/photos/thumb/${memberPrivateItemId}?s=${size}`)).statusCode).toBe(404)
		}
		expect((await getPhotosMedia(`api/photos/live/${memberPrivateItemId}`)).statusCode).toBe(404)
		await expect(downloadTicket([memberPrivateItemId])).rejects.toThrow()
		expect(
			(await getPhotosMedia(`api/photos/download?ticket=${encodeURIComponent(ownerDownloadTicket)}`)).body,
		).toEqual(ownerImage)
		expect((await getPhotosMedia(`api/photos/original/${ownerItemId}`)).body).toEqual(ownerImage)
	})

	test('keeps account state isolated while shared artifacts survive deletion and reboot', async () => {
		await useSession(memberSession)
		await umbreld.client.photos.items.setFavorite.mutate({ids: [memberItemId], favorite: true})
		await umbreld.client.photos.items.delete.mutate({ids: [memberItemId]})
		await expect(umbreld.client.photos.library.summary.query()).resolves.toMatchObject({
			counts: {items: 1, favorites: 0, deleted: 1},
		})

		await useSession(ownerSession)
		await expect(umbreld.client.photos.library.summary.query()).resolves.toMatchObject({
			counts: {items: 9, favorites: 0, deleted: 0},
		})
		expect((await getPhotosMedia(`api/photos/thumb/${ownerItemId}?s=192`)).statusCode).toBe(200)

		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		ownerSession = await login({password: ownerPassword})
		await useSession(ownerSession)
		await waitForReady()
		await expect(umbreld.client.photos.items.get.query({id: ownerItemId})).resolves.toMatchObject({
			id: ownerItemId,
		})
		await expect(umbreld.client.photos.items.get.query({id: watchedItemId})).resolves.toMatchObject({
			id: watchedItemId,
			path: '/Home/Camera/renamed-photo.png',
		})

		memberSession = await login({userId: memberId, password: memberPassword})
		await useSession(memberSession)
		await expect(umbreld.client.photos.items.list.query({filter: {deleted: true}, limit: 10})).resolves.toMatchObject({
			total: 1,
			items: [expect.objectContaining({id: memberItemId, isFavorite: true})],
		})
	})
})
