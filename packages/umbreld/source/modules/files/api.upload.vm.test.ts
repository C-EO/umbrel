import {once} from 'node:events'

import {expect, beforeAll, afterAll, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

// The entire upload API runs end-to-end here, including the disk-full write
// error case which is triggered by genuinely filling a filesystem (a tiny
// tmpfs mount) rather than mocking the server's write stream.

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Each test uses uniquely named files so no cleanup between tests is needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

const guestHome = '/home/umbrel/umbrel/home'

// Read a file's content from inside the VM (low-level assertion via SSH)
async function readGuestFile(guestPath: string) {
	return umbreld.vm.ssh(`cat '${guestPath}'`)
}

// Check a path exists inside the VM. The ssh helper ignores exit codes so we
// echo a marker instead.
async function guestPathExists(guestPath: string) {
	const output = await umbreld.vm.ssh(`test -e '${guestPath}' && echo exists || echo missing`)
	return output.trim() === 'exists'
}

test('POST /api/files/upload throws unauthorized error without cookie', async () => {
	const error = await umbreld.unauthenticatedApi
		.post('files/upload?path=/Home/test-file.txt', {body: 'test content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('POST /api/files/upload throws 400 error without path parameter', async () => {
	const error = await umbreld.api.post('files/upload', {body: 'test content'}).catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'path is required'})
})

test('POST /api/files/upload throws 400 error on directory traversal attempt', async () => {
	const error = await umbreld.api
		.post('files/upload?path=/Home/../../../../etc/dangerous-file.txt', {body: 'malicious content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid path'})
})

test('POST /api/files/upload throws 400 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.post(`files/upload?path=${path}`, {body: 'test content'}).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(400)
		expect(error.response.body).toMatchObject({error: 'invalid path'})
	}
})

test('POST /api/files/upload throws 400 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh(`ln -s / ${guestHome}/upload-symlink-to-root`)

	// Attempt to upload a file through the symlink
	const error = await umbreld.api
		.post('files/upload?path=/Home/upload-symlink-to-root/etc/dangerous-file.txt', {body: 'malicious content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid path'})
})

test('POST /api/files/upload successfully uploads a file with valid cookie and returns success response', async () => {
	// Upload a file
	const response = await umbreld.api.post('files/upload?path=/Home/new-file.txt', {
		body: 'uploaded content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/new-file.txt'})

	// Verify the file was created with the right content
	await expect(readGuestFile(`${guestHome}/new-file.txt`)).resolves.toBe('uploaded content')
})

test('POST /api/files/upload creates parent directories if they do not exist', async () => {
	// Upload a file to a path with non-existent directories
	const response = await umbreld.api.post('files/upload?path=/Home/new-dir/sub-dir/new-file.txt', {
		body: 'nested content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the directories and file were created with the right content
	await expect(readGuestFile(`${guestHome}/new-dir/sub-dir/new-file.txt`)).resolves.toBe('nested content')
})

test('POST /api/files/upload handles files with special characters in name', async () => {
	// File name with special characters
	const fileName = 'file with spaces & special chars 漢字.txt'

	// Upload the file
	const response = await umbreld.api.post(`files/upload?path=/Home/${encodeURIComponent(fileName)}`, {
		body: 'special content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created with the right content
	await expect(readGuestFile(`${guestHome}/${fileName}`)).resolves.toBe('special content')
})

test('POST /api/files/upload handles files with URL-encoded characters in path', async () => {
	// File name with characters that need URL encoding
	const filename = 'file+with?query&params.txt'

	// Upload the file
	const response = await umbreld.api.post(`files/upload?path=/Home/${encodeURIComponent(filename)}`, {
		body: 'url encoded content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created with the right content
	await expect(readGuestFile(`${guestHome}/${filename}`)).resolves.toBe('url encoded content')
})

test('POST /api/files/upload handles empty files correctly', async () => {
	// Upload an empty file
	const response = await umbreld.api.post('files/upload?path=/Home/empty-file-upload.txt', {body: ''})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created and is empty
	await expect(guestPathExists(`${guestHome}/empty-file-upload.txt`)).resolves.toBe(true)
	await expect(readGuestFile(`${guestHome}/empty-file-upload.txt`)).resolves.toBe('')
})

test('POST /api/files/upload handles binary data correctly', async () => {
	// Binary data as base64
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc]).toString('base64')

	// Upload binary file
	const response = await umbreld.api.post('files/upload?path=/Home/binary-upload.bin', {
		body: binaryData,
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the content round-trips
	await expect(readGuestFile(`${guestHome}/binary-upload.bin`)).resolves.toBe(binaryData)
})

test('POST /api/files/upload creates file with correct permissions', async () => {
	// Upload a file
	const response = await umbreld.api.post('files/upload?path=/Home/permissions-upload.txt', {
		body: 'permissions content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Check ownership is the umbrel user and group (low-level OS fact via SSH)
	const stat = await umbreld.vm.ssh(`stat --format '%u %g' ${guestHome}/permissions-upload.txt`)
	expect(stat.trim()).toBe('1000 1000')
})

test('POST /api/files/upload correctly handles streaming data in chunks', async () => {
	// Test file path
	const filePath = '/Home/streaming-test.txt'
	const systemPath = `${guestHome}/streaming-test.txt`
	const temporarySystemPath = `${guestHome}/.streaming-test.txt.umbrel-upload`

	// Get a stream for the request
	const uploadStream = umbreld.api.stream.post(`files/upload?path=${filePath}`)

	// Check file doesn't yet exist
	await expect(guestPathExists(systemPath)).resolves.toBe(false)
	await expect(guestPathExists(temporarySystemPath)).resolves.toBe(false)

	// Chunks of data to pipe to the upload stream
	const chunks = [
		Buffer.from('First chunk of data - '),
		Buffer.from('Second chunk of data - '),
		Buffer.from('Third chunk of data - '),
	]

	for (const chunk of chunks) {
		// Write the chunk to the upload stream
		uploadStream.write(chunk)

		// Wait for the chunk to land in the temporary file. Single ssh command
		// per poll since each ssh call is a fresh connection with real latency.
		let lastContent = ''
		await pWaitFor(
			async () => {
				lastContent = await umbreld.vm.ssh(`cat '${temporarySystemPath}' 2>/dev/null || true`)
				return lastContent.includes(chunk.toString())
			},
			{interval: 500, timeout: 60_000},
		).catch((error) => {
			throw new Error(`Timed out waiting for chunk '${chunk}' in temporary file, last content: '${lastContent}'`, {
				cause: error,
			})
		})

		// Check the final file still doesn't exist while the upload is in progress
		await expect(guestPathExists(systemPath)).resolves.toBe(false)
	}

	// End the stream
	uploadStream.end()

	// Check response is ok
	const [response] = await once(uploadStream, 'response')
	expect(response.statusCode).toBe(200)

	// Check if the file was moved to the final path
	await pWaitFor(async () => guestPathExists(systemPath), {interval: 500, timeout: 60_000})
	await expect(guestPathExists(temporarySystemPath)).resolves.toBe(false)

	// Check the content of the final file
	await expect(readGuestFile(systemPath)).resolves.toBe(chunks.join(''))
})

test('POST /api/files/upload cleans up temporary files when client aborts partially uploaded file', async () => {
	// Test file path
	const filePath = '/Home/aborted-upload.txt'
	const systemPath = `${guestHome}/aborted-upload.txt`
	const temporarySystemPath = `${guestHome}/.aborted-upload.txt.umbrel-upload`

	// Get a stream for the request
	const uploadStream = umbreld.api.stream.post(`files/upload?path=${filePath}`)

	// Check files don't exist yet
	await expect(guestPathExists(systemPath)).resolves.toBe(false)
	await expect(guestPathExists(temporarySystemPath)).resolves.toBe(false)

	// Write the chunk to the upload stream
	uploadStream.write(Buffer.from('First chunk'))

	// Wait for the temporary file to be created
	await pWaitFor(async () => guestPathExists(temporarySystemPath), {interval: 500, timeout: 60_000})
	await expect(guestPathExists(systemPath)).resolves.toBe(false)

	// Now abort the request
	uploadStream.destroy()

	// Wait for the backend to clean up the partially uploaded temporary file
	await pWaitFor(async () => !(await guestPathExists(temporarySystemPath)), {interval: 500, timeout: 60_000})
	await expect(guestPathExists(systemPath)).resolves.toBe(false)
})

test('POST /api/files/upload handles disk full write errors correctly', {retry: 5}, async () => {
	// Mount a tiny tmpfs so writing the uploaded file genuinely fails with
	// ENOSPC, exercising the server's write error path with a real full disk
	const guestDirectory = `${guestHome}/disk-full-test`
	await umbreld.vm.sshAsRoot(`mkdir -p '${guestDirectory}' && mount -t tmpfs -o size=1m tmpfs '${guestDirectory}'`)

	try {
		// Upload a file slightly larger than the filesystem so the request body
		// is fully received before the final write fails
		const error = await umbreld.api
			.post('files/upload?path=/Home/disk-full-test/should-fail.bin', {body: Buffer.alloc(1024 * 1024 + 8 * 1024)})
			.catch((error) => error)

		// Verify the error response
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(500)
		expect(error.response.body).toMatchObject({error: 'error writing file'})

		// Verify the partially written temporary file was cleaned up and the
		// final file was never created
		await pWaitFor(async () => !(await guestPathExists(`${guestDirectory}/.should-fail.bin.umbrel-upload`)), {
			interval: 500,
			timeout: 60_000,
		})
		await expect(guestPathExists(`${guestDirectory}/should-fail.bin`)).resolves.toBe(false)
	} finally {
		// Remove the tmpfs mount
		await umbreld.vm.sshAsRoot(`umount '${guestDirectory}' && rmdir '${guestDirectory}'`)
	}
})

test('POST /api/files/upload with collision=error (default) throws 400 when file already exists', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/collision-test.txt', {body: 'original content'})

	// Try to upload to the same path
	const error = await umbreld.api
		.post('files/upload?path=/Home/collision-test.txt', {body: 'new content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: '[destination-already-exists]'})

	// Verify the file wasn't changed
	await expect(readGuestFile(`${guestHome}/collision-test.txt`)).resolves.toBe('original content')
})

test('POST /api/files/upload with collision=error throws 400 when explicitly set and file already exists', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/explicit-error-test.txt', {body: 'original content'})

	// Try to upload to the same path with explicit error strategy
	const error = await umbreld.api
		.post('files/upload?path=/Home/explicit-error-test.txt&collision=error', {body: 'new content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: '[destination-already-exists]'})

	// Verify the file wasn't changed
	await expect(readGuestFile(`${guestHome}/explicit-error-test.txt`)).resolves.toBe('original content')
})

test('POST /api/files/upload with collision=keep-both creates uniquely named file when file already exists', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/keep-both-test.txt', {body: 'original content'})

	// Upload to the same path with keep-both strategy
	const response = await umbreld.api.post('files/upload?path=/Home/keep-both-test.txt&collision=keep-both', {
		body: 'new content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/keep-both-test (2).txt'})

	// Verify both files exist with correct content
	await expect(readGuestFile(`${guestHome}/keep-both-test.txt`)).resolves.toBe('original content')
	await expect(readGuestFile(`${guestHome}/keep-both-test (2).txt`)).resolves.toBe('new content')
})

test('POST /api/files/upload with collision=keep-both increments number for multiple collisions', async () => {
	// Create a file and its first duplicate through the upload API
	await umbreld.api.post('files/upload?path=/Home/multiple-test.txt', {body: 'original content'})
	await umbreld.api.post(`files/upload?path=${encodeURIComponent('/Home/multiple-test (2).txt')}`, {
		body: 'first duplicate',
	})

	// Upload to the same path with keep-both strategy
	const response = await umbreld.api.post('files/upload?path=/Home/multiple-test.txt&collision=keep-both', {
		body: 'second duplicate',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/multiple-test (3).txt'})

	// Verify all files exist with correct content
	await expect(readGuestFile(`${guestHome}/multiple-test.txt`)).resolves.toBe('original content')
	await expect(readGuestFile(`${guestHome}/multiple-test (2).txt`)).resolves.toBe('first duplicate')
	await expect(readGuestFile(`${guestHome}/multiple-test (3).txt`)).resolves.toBe('second duplicate')
})

test('POST /api/files/upload with collision=replace overwrites existing file', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/replace-test.txt', {body: 'original content'})

	// Upload to the same path with replace strategy
	const response = await umbreld.api.post('files/upload?path=/Home/replace-test.txt&collision=replace', {
		body: 'replacement content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/replace-test.txt'})

	// Verify file exists with new content
	await expect(readGuestFile(`${guestHome}/replace-test.txt`)).resolves.toBe('replacement content')
})

test('POST /api/files/upload with invalid collision parameter returns 400 error', async () => {
	const error = await umbreld.api
		.post('files/upload?path=/Home/invalid-collision-test.txt&collision=invalid', {body: 'test content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid collision parameter'})
})
