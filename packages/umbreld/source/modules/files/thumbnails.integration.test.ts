/*
The behavioural thumbnail tests are covered end-to-end in
thumbnails.vm.test.ts. The tests here remain integration tests because they
reach into umbreld internals: tuning the housekeeping thresholds, stopping
and starting the instance in-process, and spying on the generation queues.

Tests that involve the background watcher can be flaky in CI due to variable
watcher event delays and generation times, so they wait for the debounce,
poll with generous timeouts and auto-retry.
*/

import nodePath from 'node:path'

import {expect, test, describe, beforeEach, afterEach, vi} from 'vitest'
import fse from 'fs-extra'
import {delay} from 'es-toolkit'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Create new umbreld instance for each test
beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

// Clean up after each test
afterEach(async () => {
	await umbreld.cleanup()
})

// Helper to copy fixture files for testing
async function copyFixtureFile(
	destinationDir: string,
	fixtureName: string = 'master-lossless-image.png',
	customName?: string,
) {
	// Ensure target directory exists
	await fse.ensureDir(destinationDir)

	// Fixture files are in the same parent directory as this test file at /fixures/thumbnails
	const fixturePath = nodePath.resolve(__dirname, 'fixtures', 'thumbnails', fixtureName)

	// Construct destination path by joining directory and fixture name
	const destinationPath = nodePath.join(destinationDir, customName || fixtureName)

	// Copy the fixture file to the test location
	await fse.copy(fixturePath, destinationPath)

	// return the destination path
	return destinationPath
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

describe('Thumbnail generation', () => {
	test('recreates a missing thumbnail directory on demand', async () => {
		const testDir = `${umbreld.instance.dataDirectory}/external/thumbnail-missing-directory-test`
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		await copyFixtureFile(testDir)

		await fse.remove(thumbnailDir)
		const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({
			path: '/External/thumbnail-missing-directory-test/master-lossless-image.png',
		})

		// The URL carries the source path as a query string, so read the filename
		// off the pathname rather than splitting the whole URL.
		const thumbnailName = nodePath.basename(new URL(thumbnailUrl, 'http://localhost').pathname)
		await expect(fse.pathExists(nodePath.join(thumbnailDir, thumbnailName))).resolves.toBe(true)
	})
})

describe('Thumbnail housekeeping', () => {
	test('removes oldest thumbnails when exceeding cleanup threshold', {retry: 5}, async () => {
		// Set a lower maxThumbnailCount and pruningThreshold for testing
		const thumbnailsInstance = umbreld.instance.files.thumbnails
		thumbnailsInstance.maxThumbnailCount = 20
		thumbnailsInstance.pruningThreshold = 10

		// Create test images directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-cleanup-test`
		await fse.mkdir(testDir)

		// STEP 1: Create initial batch of images (just under threshold)
		// With maxThumbnailCount=20 and pruningThreshold=10, cleanup should happen at 30 images
		// So we create 29 images first (which shouldn't trigger cleanup)
		const initialBatchSize = 29
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`

		// Create first batch of images (29)
		for (let i = 0; i < initialBatchSize; i++) {
			await copyFixtureFile(testDir, 'master-lossless-image.png', `cleanup-${i}.png`)
		}

		// Wait for watcher to automatically create thumbnails for first batch
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length >= initialBatchSize
			},
			{
				timeoutMs: 15000,
				errorMessage: "Watcher didn't create expected thumbnails for first batch",
			},
		)

		// Count thumbnails after first batch
		const firstBatchThumbnails = await fse.readdir(thumbnailDir)

		// Verify no cleanup happened yet (we should have all 29 thumbnails)
		expect(firstBatchThumbnails.length).toBeGreaterThanOrEqual(initialBatchSize)

		// Wait a moment to ensure we're not in the middle of any operations
		await delay(500)

		// STEP 2: Create one more image to trigger cleanup
		// This should be the 30th image, which should trigger cleanup
		await copyFixtureFile(testDir, 'master-lossless-image.png', 'cleanup-trigger.png')

		// Wait for cleanup to complete
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length <= thumbnailsInstance.maxThumbnailCount && thumbnails.length > 0
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Cleanup did not complete within timeout period',
			},
		)

		// Get final thumbnail count
		const finalThumbnails = await fse.readdir(thumbnailDir)

		// Number of thumbnails should be equal to our test maxThumbnailCount
		expect(finalThumbnails.length).toBe(20)
	})

	test('removes excess thumbnails on startup', {retry: 5}, async () => {
		// Stop umbreld
		await umbreld.instance.stop()

		// Set a lower maxThumbnailCount for testing
		const maxThumbnailCount = 20
		umbreld.instance.files.thumbnails.maxThumbnailCount = maxThumbnailCount

		// Create the thumbnails directory if it doesn't exist already
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		await fse.ensureDir(thumbnailDir)

		// Create excess dummy thumbnail files (e.g., 40 files, which is double the max for this test)
		const totalThumbnailCount = maxThumbnailCount * 2

		// Create timestamps with increasing age to ensure deterministic pruning
		const now = Date.now()

		// Create dummy thumbnail files with controlled timestamps
		for (let i = 0; i < totalThumbnailCount; i++) {
			const thumbnailPath = `${thumbnailDir}/dummy-${i.toString().padStart(3, '0')}.webp`
			await fse.writeFile(thumbnailPath, 'dummy thumbnail content')

			// Set file timestamps - older files will be removed first
			// First half (0-19) will be older, second half (20-39) will be newer
			const fileTime = new Date(now - (totalThumbnailCount - i) * 1000)
			await fse.utimes(thumbnailPath, fileTime, fileTime)
		}

		// Verify we have the expected number of dummy thumbnails
		const initialThumbnails = await fse.readdir(thumbnailDir)
		expect(initialThumbnails.length).toBe(totalThumbnailCount)

		// Now start the umbrel instance - this should trigger the cleanup on startup
		await umbreld.instance.start()

		// Wait for cleanup to complete and verify
		await pollUntil(
			async () => {
				const thumbnails = await fse.readdir(thumbnailDir)
				return thumbnails.length <= maxThumbnailCount
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Startup cleanup did not complete within timeout period',
			},
		)

		// Get final thumbnail count
		const finalThumbnails = await fse.readdir(thumbnailDir)

		// Number of thumbnails should be equal to maxThumbnailCount
		expect(finalThumbnails.length).toBe(maxThumbnailCount)

		// Verify the newer thumbnails were kept
		// The thumbnails with higher indices in their names should be kept
		// (these were the ones with newer timestamps)
		for (const thumbnail of finalThumbnails) {
			// Extract the index from the filename
			const match = thumbnail.match(/dummy-(\d+)\.webp/)
			if (match) {
				const index = parseInt(match[1], 10)
				// All kept thumbnails should be from the newer half (indices 20-39)
				expect(index).toBeGreaterThanOrEqual(totalThumbnailCount - maxThumbnailCount)
			}
		}
	})
})

describe('Queue selection', () => {
	test('uses background queue for watcher events and on-demand queue for explicit requests', {retry: 5}, async () => {
		// Create test directory
		const testDir = `${umbreld.instance.dataDirectory}/home/thumbnail-queue-test`
		await fse.ensureDir(testDir)

		// Track queue usage by spying on both queue's add method
		const thumbnailsInstance = umbreld.instance.files.thumbnails
		const backgroundAddSpy = vi.spyOn(thumbnailsInstance.backgroundQueue, 'add')
		const onDemandAddSpy = vi.spyOn(thumbnailsInstance.onDemandQueue, 'add')

		// Reset spy counts before test
		backgroundAddSpy.mockClear()
		onDemandAddSpy.mockClear()

		// PART 1: Test background queue is used for file watcher events

		// Copy the image file to trigger background watcher
		await copyFixtureFile(testDir)

		// Wait for the watcher to pick up the file and process it
		await pollUntil(
			async () => {
				return backgroundAddSpy.mock.calls.length > 0
			},
			{
				timeoutMs: 15000,
				errorMessage: 'Background queue was not used for watcher-triggered thumbnail',
			},
		)

		// Verify background queue was used, but on-demand queue was not
		expect(backgroundAddSpy).toHaveBeenCalled()
		expect(onDemandAddSpy).not.toHaveBeenCalled()

		// Reset spy counts for second part of test
		backgroundAddSpy.mockClear()
		onDemandAddSpy.mockClear()

		// PART 2: Test on-demand queue is used for explicit thumbnail requests

		// delete the single thumbnail
		const thumbnailDir = `${umbreld.instance.dataDirectory}/thumbnails`
		let thumbnails = await fse.readdir(thumbnailDir)
		await fse.remove(`${thumbnailDir}/${thumbnails[0]}`)

		// Verify that thumbnails dir is empty
		thumbnails = await fse.readdir(thumbnailDir)
		expect(thumbnails.length).toBe(0)

		// request the thumbnail via the API
		const virtualPath = '/Home/thumbnail-queue-test/master-lossless-image.png'
		await umbreld.client.files.getThumbnail.mutate({path: virtualPath})

		// Verify that the thumbnail was generated
		thumbnails = await fse.readdir(thumbnailDir)
		expect(thumbnails.length).toBe(1)

		// Verify that the thumbnail was generated in the on-demand queue
		expect(onDemandAddSpy).toHaveBeenCalled()
		expect(backgroundAddSpy).not.toHaveBeenCalled()
	})
})
