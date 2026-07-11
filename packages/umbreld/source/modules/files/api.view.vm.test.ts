import {expect, beforeAll, afterAll, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

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

// Create a file through the files API
async function uploadFile(path: string, content: string | Buffer) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

test('GET /api/files/view throws unauthorized error without cookie', async () => {
	const error = await umbreld.unauthenticatedApi.get('files/view').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('GET /api/files/view throws 404 error without path parameter', async () => {
	const error = await umbreld.api.get('files/view').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'path is required'})
})

test('GET /api/files/view throws 404 error when file does not exist', async () => {
	const error = await umbreld.api.get('files/view?path=/Home/does-not-exist').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error on directory traversal attempt', async () => {
	const error = await umbreld.api.get('files/view?path=/Home/../../../../etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.get(`files/view?path=${path}`).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(404)
		expect(error.response.body).toMatchObject({error: 'not found'})
	}
})

test('GET /api/files/view throws 404 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh('ln -s / /home/umbrel/umbrel/home/view-symlink-to-root')

	// Attempt to access files through the symlink
	const error = await umbreld.api.get('files/view?path=/Home/view-symlink-to-root/etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error when trying to view a directory', async () => {
	// Create a directory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/view-test-dir'})

	// Try to view the directory
	const error = await umbreld.api.get('files/view?path=/Home/view-test-dir').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'cannot view a directory'})
})

test('GET /api/files/view serves a file with a valid cookie', async () => {
	// Create a file
	await uploadFile('/Home/view-file.txt', 'contents')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/view-file.txt', {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('contents')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('text/plain')
	expect(response.headers['content-disposition']).toBeUndefined()
	// View doesn't set Content-Disposition header as it's for viewing, not downloading
})

test('GET /api/files/view forces HTML files to download', async () => {
	// Create an HTML file
	await uploadFile('/Home/poc-download.html', '<script>alert("xss")</script>')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/poc-download.html', {
		responseType: 'text',
	})

	// Assert the response is forced to download rather than render inline
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<script>alert("xss")</script>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('application/octet-stream')
	expect(response.headers['content-disposition']).toBe("attachment; filename*=UTF-8''poc-download.html")
})

test('GET /api/files/view forces SVG files to download', async () => {
	// Create an SVG file
	await uploadFile(
		'/Home/poc-svg-download.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
	)

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/poc-svg-download.svg', {
		responseType: 'text',
	})

	// Assert the response is forced to download rather than render inline
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('application/octet-stream')
	expect(response.headers['content-disposition']).toBe("attachment; filename*=UTF-8''poc-svg-download.svg")
})

test('GET /api/files/view serves SVG files inline for image embeds', async () => {
	// Create an SVG file
	await uploadFile(
		'/Home/poc-svg-inline.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
	)

	// View the file as an embedded image
	const response = await umbreld.api.get('files/view?path=/Home/poc-svg-inline.svg', {
		responseType: 'text',
		headers: {'Sec-Fetch-Dest': 'image'},
	})

	// Assert the response can render in an <img>, with CSP and nosniff still applied
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('image/svg+xml')
	expect(response.headers['content-disposition']).toBeUndefined()
})

test('GET /api/files/view serves SVG files inline for image accepts without fetch metadata', async () => {
	// Create an SVG file
	await uploadFile(
		'/Home/poc-svg-accept.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
	)

	// View the file as an embedded image from browsers that don't send Sec-Fetch-Dest on local HTTP origins
	const response = await umbreld.api.get('files/view?path=/Home/poc-svg-accept.svg', {
		responseType: 'text',
		headers: {Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'},
	})

	// Assert the response can render in an <img>, with CSP and nosniff still applied
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('image/svg+xml')
	expect(response.headers['content-disposition']).toBeUndefined()
})

test('GET /api/files/view handles files with special characters in name', async () => {
	// Create a file with special characters in the name
	const fileName = 'file with spaces & special chars 漢字.txt'
	await uploadFile(`/Home/${fileName}`, 'special contents')

	// View the file
	const response = await umbreld.api.get(`files/view?path=/Home/${encodeURIComponent(fileName)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('special contents')
})

test('GET /api/files/view handles files with URL-encoded characters in path', async () => {
	// Create a file with characters that need URL encoding
	const filename = 'file+with?query&params.txt'
	await uploadFile(`/Home/${filename}`, 'url encoded content')

	// View the file using URL encoded path
	const response = await umbreld.api.get(`files/view?path=/Home/${encodeURIComponent(filename)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('url encoded content')
})

test('GET /api/files/view handles files with zero content correctly', async () => {
	// Create an empty file
	await uploadFile('/Home/empty-file.txt', '')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/empty-file.txt', {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('')
})

test('GET /api/files/view handles binary files correctly', async () => {
	// Create a small binary file
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc])
	await uploadFile('/Home/binary-file.bin', binaryData)

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/binary-file.bin', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(Buffer.from(response.body)).toEqual(binaryData)
})
