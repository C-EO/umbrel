/*
Tests that involve the background watcher (e.g., those relying on file changes
to trigger thumbnail generation) can be flaky in CI due to variable watcher
event delays and generation times (via convert/FFmpeg). We do the following to
give a high probability of success:
- waitForThumbnailDebounce(): Explicitly waits 1500ms after ops to cover the
  1000ms debounce + event propagation/CI variability.
- pollUntil timeouts: continues polling for existence of a thumbnail for
  15000ms (15s) for thumbnail generation breathing room in CI.
- { retry: 5 }: Auto-retries to handle timing outliers.

The housekeeping and queue-selection tests are covered in
thumbnails.integration.test.ts because they reach into umbreld internals.
Everything here runs end-to-end against the VM: the thumbnails directory is
owned by umbreld running as root, so it's inspected and cleaned over SSH as
root, and it's emptied before each test since the whole suite shares one VM.
*/

import nodePath from 'node:path'

import {expect, test, describe, beforeAll, beforeEach, afterAll} from 'vitest'
import fse from 'fs-extra'
import {delay} from 'es-toolkit'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()

	// Upload the master fixtures once so the image/video type tests can derive
	// other formats from them inside the VM (umbrelOS ships ImageMagick and
	// FFmpeg since umbreld itself uses them for thumbnail generation)
	const masterFixturePaths = [
		'/Home/fixture-masters/master-lossless-image.png',
		'/Home/fixture-masters/master-lossless-video.mkv',
	]
	await uploadFixtureFile(masterFixturePaths[0], 'master-lossless-image.png')
	await uploadFixtureFile(masterFixturePaths[1], 'master-lossless-video.mkv')

	// Generate the setup-only master thumbnails through the real on-demand API
	// so suite startup does not race the background watcher's initial readiness.
	// This also ensures later watcher events find the thumbnails already present;
	// watcher generation itself is exercised by the dedicated tests below.
	await Promise.all(masterFixturePaths.map((path) => umbreld.client.files.getThumbnail.mutate({path})))
	await pollUntil(async () => (await listThumbnails()).length >= 2, {
		timeoutMs: 30000,
		errorMessage: 'Master fixture thumbnails were not generated',
	})
})

afterAll(async () => {
	await umbreld.cleanup()
})

// The suite shares one VM so empty the thumbnails directory before each test
// to keep the count-based assertions meaningful. Wait out the watcher debounce
// first so pending events from the previous test fire while their thumbnails
// still exist (and get skipped) instead of regenerating them after the wipe.
beforeEach(async () => {
	await waitForThumbnailDebounce()
	await umbreld.vm.sshAsRoot('mkdir -p /home/umbrel/umbrel/thumbnails && rm -rf /home/umbrel/umbrel/thumbnails/*')
})

const guestThumbnailDir = '/home/umbrel/umbrel/thumbnails'
const guestHome = '/home/umbrel/umbrel/home'

// Create a file through the files API
async function uploadFile(path: string, content: string | Buffer) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

// Upload a fixture file into the VM through the files API
async function uploadFixtureFile(destinationPath: string, fixtureName: string = 'master-lossless-image.png') {
	const fixturePath = nodePath.resolve(__dirname, 'fixtures', 'thumbnails', fixtureName)
	await uploadFile(destinationPath, await fse.readFile(fixturePath))
}

// List the thumbnail file names inside the VM (the directory is owned by
// umbreld running as root)
async function listThumbnails() {
	const output = await umbreld.vm.sshAsRoot(`ls -1A '${guestThumbnailDir}' 2>/dev/null || true`)
	return output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
}

// Helper function to poll until a condition is met or timeout occurs
async function pollUntil(
	condition: () => Promise<boolean>,
	{
		timeoutMs = 5000,
		intervalMs = 100,
		errorMessage = 'Polling timed out',
	}: {
		timeoutMs?: number
		intervalMs?: number
		errorMessage?: string
	} = {},
): Promise<void> {
	const startTime = Date.now()

	while (Date.now() - startTime < timeoutMs) {
		if (await condition()) return
		await delay(intervalMs)
	}

	throw new Error(errorMessage)
}

// Helper to wait for the thumbnail generation debounce period after file operations (1000ms in thumbnails.ts).
// The production debounce resets on each event for the path (e.g., multiple update's during copy), waiting 1000ms after the last one before generating.
// We use a slightly longer period (1500ms) to account for FS event propagation, potential reset-triggering events, and CI variability before polling starts.
const waitForThumbnailDebounce = () => delay(1500)

describe('getThumbnail', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.getThumbnail.mutate({path: '/Home/test.jpg'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test.todo('cannot generate thumbnail outside of /Home /Apps /Trash /External')

	test('returns a correctly formatted api endpoint URL for a thumbnail', async () => {
		// Create test image
		const virtualPath = '/Home/thumb-url-test/master-lossless-image.png'
		await uploadFixtureFile(virtualPath)

		// Get api endpoint URL for thumbnail
		const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify URL matches expected format (api endpoint of /api/files/thumbnail/:hash.webp where :hash is a valid hash)
		expect(thumbnailUrl).toBeTruthy()
		expect(thumbnailUrl).toMatch(/^\/api\/files\/thumbnail\/[a-f0-9]+\.webp$/i)
	})

	// This test specifically checks that getThumbnail triggers thumbnail generation when one does not exist
	// Other getThumbnail tests below this one can only guarantee that the thumbnail hash is returned, but it may have been generated via the background watcher or on-demand
	test('generates thumbnails on-demand when no thumbnail exists', {retry: 5}, async () => {
		// Create test image
		const virtualPath = '/Home/thumb-ondemand-test/master-lossless-image.png'
		await uploadFixtureFile(virtualPath)

		await waitForThumbnailDebounce()

		// Wait for background watcher to generate the thumbnail so we are sure it won't interfere with the test
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Background watcher did not generate thumbnail',
		})

		// Delete the thumbnail
		await umbreld.vm.sshAsRoot(`rm -rf ${guestThumbnailDir}/*`)

		// Verify thumbnail was deleted by checking that no files exist in the thumbnails directory
		await expect(listThumbnails()).resolves.toHaveLength(0)

		// Call getThumbnail - it should generate the thumbnail on-demand
		const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify thumbnail was generated
		const thumbnailFilename = thumbnailUrl.split('/').pop()!
		await expect(listThumbnails()).resolves.toContain(thumbnailFilename)
	})

	const imageTypes = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']

	for (const imageType of imageTypes) {
		test(`returns a thumbnail for a ${imageType} file`, async () => {
			// Use ImageMagick inside the VM to convert the PNG master fixture to
			// the test image type (the ssh helper ignores exit codes so echo a
			// marker to detect conversion failures)
			const guestImagePath = `${guestHome}/thumb-image-types/test-image${imageType}`
			const conversion = await umbreld.vm.ssh(
				`mkdir -p '${guestHome}/thumb-image-types' && convert '${guestHome}/fixture-masters/master-lossless-image.png' '${guestImagePath}' && echo converted`,
			)
			expect(conversion).toContain('converted')

			// Get api endpoint URL
			const virtualPath = `/Home/thumb-image-types/test-image${imageType}`
			const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

			// Verify thumbnail file was created
			const thumbnailFilename = thumbnailUrl.split('/').pop()!
			await expect(listThumbnails()).resolves.toContain(thumbnailFilename)
		})
	}

	test.todo('returns a thumbnail for a heic file once we support it')

	const videoTypes = ['.mkv', '.mov', '.mp4', '.3gp', '.avi']

	for (const videoType of videoTypes) {
		test(`returns a thumbnail for a ${videoType} file`, async () => {
			// Use FFmpeg inside the VM to convert the mkv master fixture to the
			// test video type (the ssh helper ignores exit codes so echo a
			// marker to detect conversion failures)
			const guestVideoPath = `${guestHome}/thumb-video-types/test-video${videoType}`
			const conversion = await umbreld.vm.ssh(
				`mkdir -p '${guestHome}/thumb-video-types' && ffmpeg -i '${guestHome}/fixture-masters/master-lossless-video.mkv' -c:v libx264 '${guestVideoPath}' && echo converted`,
			)
			expect(conversion).toContain('converted')

			// Get api endpoint URL for thumbnail
			const virtualPath = `/Home/thumb-video-types/test-video${videoType}`
			const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

			// Verify thumbnail file was created
			const thumbnailFilename = thumbnailUrl.split('/').pop()!
			await expect(listThumbnails()).resolves.toContain(thumbnailFilename)
		})
	}

	test.todo('returns a thumbnail for a pdf file')

	test('returns same thumbnail for renamed files', async () => {
		// Create test directory and image
		const virtualPath = '/Home/thumb-rename-test/master-lossless-image.png'
		await uploadFixtureFile(virtualPath)

		// Get original thumbnail's api endpoint URL
		const originalThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Rename the file through the files API
		await umbreld.client.files.rename.mutate({path: virtualPath, newName: 'renamed.png'})

		// Get thumbnail's api endpoint URL for renamed file
		const renamedThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({
			path: '/Home/thumb-rename-test/renamed.png',
		})

		// The thumbnail's api endpoint URL should be the same since filesystem UUID, inode, and date modified are the same
		expect(renamedThumbnailUrl).toBe(originalThumbnailUrl)
	})

	test('returns same thumbnail for moved files', async () => {
		// Create test directories and image
		const virtualPath = '/Home/thumb-move-test/source/master-lossless-image.png'
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-move-test'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-move-test/source'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-move-test/destination'})
		await uploadFixtureFile(virtualPath)

		// Get original thumbnail api endpoint URL
		const originalThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Move the file to a different directory with same name through the files API
		await umbreld.client.files.move.mutate({path: virtualPath, toDirectory: '/Home/thumb-move-test/destination'})

		// Get thumbnail's api endpoint URL for moved file
		const movedThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({
			path: '/Home/thumb-move-test/destination/master-lossless-image.png',
		})

		// The thumbnail's api endpoint URL should be the same since filesystem UUID, inode, and date modified are the same
		expect(movedThumbnailUrl).toBe(originalThumbnailUrl)
	})

	test('generates a new thumbnail when source file is modified', async () => {
		// Create test directory and image
		const virtualPath = '/Home/thumb-modify-test/master-lossless-image.png'
		await uploadFixtureFile(virtualPath)

		// Get original thumbnail api endpoint URL
		const originalThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify original thumbnail was created
		const originalThumbnailFilename = originalThumbnailUrl.split('/').pop()!
		await expect(listThumbnails()).resolves.toContain(originalThumbnailFilename)

		// Modify the file timestamp without changing content
		await umbreld.vm.ssh(`touch '/home/umbrel/umbrel/home/thumb-modify-test/master-lossless-image.png'`)

		// Get thumbnail's api endpoint URL for modified file - should be a different hash because modification time has changed
		const modifiedThumbnailUrl = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})
		expect(modifiedThumbnailUrl).not.toBe(originalThumbnailUrl)

		// Verify new thumbnail was created
		const newThumbnailFilename = modifiedThumbnailUrl.split('/').pop()!
		await expect(listThumbnails()).resolves.toContain(newThumbnailFilename)
	})

	test('returns existing thumbnails when they exist without generating a new one', async () => {
		// Create test image
		const virtualPath = '/Home/thumb-existing-test/master-lossless-image.png'
		await uploadFixtureFile(virtualPath)

		// Get thumbnail api endpoint URL first time
		const thumbnailUrl1 = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Get the thumbnail file's modified time
		const thumbnailFilename = thumbnailUrl1.split('/').pop()!
		const mtime = await umbreld.vm.sshAsRoot(`stat --format %y '${guestThumbnailDir}/${thumbnailFilename}'`)

		// Wait a moment
		await delay(100)

		// Request thumbnail again
		const thumbnailUrl2 = await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// The thumbnail's api endpoint URL should be the same
		expect(thumbnailUrl2).toBe(thumbnailUrl1)

		// Verify the thumbnail file was not re-generated
		const mtime2 = await umbreld.vm.sshAsRoot(`stat --format %y '${guestThumbnailDir}/${thumbnailFilename}'`)
		expect(mtime2).toBe(mtime)
	})
})

describe('Background file watcher', () => {
	test('generates thumbnails for new image files', {retry: 5}, async () => {
		// Upload the image file to trigger the background watcher
		await uploadFixtureFile('/Home/thumb-watcher-test/master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate thumbnail for new image',
		})

		// Since the thumbnails directory was cleaned before the test, there
		// should be exactly one thumbnail
		await expect(listThumbnails()).resolves.toHaveLength(1)
	})

	test('does not update thumbnails when files are moved', {retry: 5}, async () => {
		// Create test directories and image
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-watcher-move-test'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-watcher-move-test/source'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-watcher-move-test/destination'})
		await uploadFixtureFile('/Home/thumb-watcher-move-test/source/master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail',
		})

		// Get the thumbnail file's modified time
		const [thumbnail] = await listThumbnails()
		const initialMtime = await umbreld.vm.sshAsRoot(`stat --format %y '${guestThumbnailDir}/${thumbnail}'`)

		// Move the file to a different directory with same name through the files API
		await umbreld.client.files.move.mutate({
			path: '/Home/thumb-watcher-move-test/source/master-lossless-image.png',
			toDirectory: '/Home/thumb-watcher-move-test/destination',
		})

		// Wait a conservative period to confirm the thumbnail was not re-generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// There should still be just one thumbnail since moving doesn't change
		// the source file's inode, filesystem UUID, or date modified
		await expect(listThumbnails()).resolves.toHaveLength(1)

		// Verify that the thumbnail's modified time remains the same to ensure it was not re-generated
		const finalMtime = await umbreld.vm.sshAsRoot(`stat --format %y '${guestThumbnailDir}/${thumbnail}'`)
		expect(finalMtime).toBe(initialMtime)
	})

	test('does not update thumbnails when files are renamed', {retry: 5}, async () => {
		// Create test directory and image
		await uploadFixtureFile('/Home/thumb-watcher-rename-test/master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail',
		})

		// Get the thumbnail file's modified time
		const [thumbnail] = await listThumbnails()
		const initialMtime = await umbreld.vm.sshAsRoot(`stat --format %y '${guestThumbnailDir}/${thumbnail}'`)

		// Rename the file in the same directory through the files API
		await umbreld.client.files.rename.mutate({
			path: '/Home/thumb-watcher-rename-test/master-lossless-image.png',
			newName: 'renamed.png',
		})

		// Wait a conservative period to confirm the thumbnail was not re-generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// There should still be just one thumbnail since renaming doesn't
		// change the inode, filesystem UUID, or date modified
		await expect(listThumbnails()).resolves.toHaveLength(1)

		// Verify that the thumbnail's modified time remains the same
		const finalMtime = await umbreld.vm.sshAsRoot(`stat --format %y '${guestThumbnailDir}/${thumbnail}'`)
		expect(finalMtime).toBe(initialMtime)
	})

	test('updates thumbnails when files are modified', {retry: 5}, async () => {
		// Create test directory and image
		await uploadFixtureFile('/Home/thumb-watcher-modify-test/master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail',
		})

		// Get initial thumbnail info
		const [initialThumbnail] = await listThumbnails()
		const initialThumbnailHash = initialThumbnail.split('.')[0]

		// Modify the file timestamp without changing content
		await umbreld.vm.ssh(`touch '/home/umbrel/umbrel/home/thumb-watcher-modify-test/master-lossless-image.png'`)

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the modification and generate a new thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 2, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate new thumbnail after file modification',
		})

		// Verify that the new thumbnail is different from the initial one
		const finalThumbnails = await listThumbnails()
		expect(finalThumbnails.length).toBe(2)
		const newThumbnailExists = finalThumbnails.some((t) => !t.startsWith(initialThumbnailHash))
		expect(newThumbnailExists).toBe(true)
	})

	test('ignores directories', {retry: 5}, async () => {
		// Create test directory
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-watcher-dir-test'})

		// Wait a conservative period to confirm the thumbnail was not generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// There should be no thumbnails
		await expect(listThumbnails()).resolves.toHaveLength(0)
	})

	test('ignores unsupported file types for thumbnails', {retry: 5}, async () => {
		// Create a txt file
		await uploadFile('/Home/thumb-watcher-unsupported-test/test.txt', 'test')

		await waitForThumbnailDebounce()

		// Wait a conservative period to confirm that the thumbnail was not generated
		// Note: Fixed delay is a bit hacky for negative assertion; uses 10000ms to cover debounce (1000ms) + potential generation time + CI buffer.
		await delay(10000)

		// There should be no thumbnails
		await expect(listThumbnails()).resolves.toHaveLength(0)
	})
})

describe('files.list() [thumbnail specific]', () => {
	test('includes thumbnail for a file with an existing thumbnail', async () => {
		// Upload the image file
		await uploadFixtureFile('/Home/thumb-list-test/master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail',
		})

		// List the files in the test directory - files.list()
		const files = await umbreld.client.files.list.query({path: '/Home/thumb-list-test'})

		// Verify the thumbnail property is included for the listed file
		expect(files.files[0].thumbnail).toBeDefined()

		// Verify the thumbnail included in the listed file is the same as the one generated above
		const [thumbnail] = await listThumbnails()

		// Add api endpoint details for proper comparison
		// We expect the thumbnail in the listed file to be of the format `/api/files/thumbnail/{hash}.webp`
		expect(files.files[0].thumbnail).toBe(`/api/files/thumbnail/${thumbnail}`)
	})

	test('does not include thumbnail for files without an existing thumbnail', async () => {
		// Upload the image file
		await uploadFixtureFile('/Home/thumb-list-missing-test/master-lossless-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail',
		})

		// Delete the generated thumbnail
		await umbreld.vm.sshAsRoot(`rm -rf ${guestThumbnailDir}/*`)
		await expect(listThumbnails()).resolves.toHaveLength(0)

		// List the files in the test directory - files.list()
		const files = await umbreld.client.files.list.query({path: '/Home/thumb-list-missing-test'})

		// Verify that no thumbnail is included for the file
		expect(files.files[0].thumbnail).toBeUndefined()
	})

	test('does not include thumbnail for directories', async () => {
		// Create test directory with a subdirectory
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-list-dir-test'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/thumb-list-dir-test/subdir'})

		// List the files in the test directory - files.list()
		const files = await umbreld.client.files.list.query({path: '/Home/thumb-list-dir-test'})

		// Verify that no thumbnail is included for the directory
		expect(files.files[0].thumbnail).toBeUndefined()
	})
})

describe('recents() [thumbnail specific]', () => {
	test('includes thumbnail for a recent file with an existing thumbnail', {retry: 5}, async () => {
		// Upload an image file
		await uploadFixtureFile('/Home/thumb-recents-test/recent-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail for recent file',
		})

		// Get recent files. The suite shares one VM so find our file by name
		// rather than assuming it's the only recent file.
		const recentFiles = await umbreld.client.files.recents.query()
		const recentImage = recentFiles.find((file) => file.name === 'recent-image.png')

		// Verify the thumbnail property is included for the recent file
		expect(recentImage?.thumbnail).toBeDefined()

		// Verify the thumbnail included is the same as the one generated above
		const [thumbnail] = await listThumbnails()
		expect(recentImage?.thumbnail).toBe(`/api/files/thumbnail/${thumbnail}`)
	})

	test('does not include thumbnail for a recent file without an existing thumbnail', async () => {
		// Upload an image file
		await uploadFixtureFile('/Home/thumb-recents-missing-test/recent-missing-image.png')

		await waitForThumbnailDebounce()

		// Wait for watcher to detect the file and generate thumbnail
		await pollUntil(async () => (await listThumbnails()).length === 1, {
			timeoutMs: 15000,
			errorMessage: 'Watcher did not generate initial thumbnail',
		})

		// Delete the generated thumbnail
		await umbreld.vm.sshAsRoot(`rm -rf ${guestThumbnailDir}/*`)
		await expect(listThumbnails()).resolves.toHaveLength(0)

		// Get recent files and find our file by name
		const recentFiles = await umbreld.client.files.recents.query()
		const recentImage = recentFiles.find((file) => file.name === 'recent-missing-image.png')

		// Verify the thumbnail property is not included for the recent file
		expect(recentImage).toBeDefined()
		expect(recentImage?.thumbnail).toBeUndefined()
	})
})
