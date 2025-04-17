import http from 'node:http'
import process from 'node:process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {createGzip} from 'node:zlib'
import {pipeline} from 'node:stream/promises'

import {$} from 'execa'
import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import {WebSocketServer} from 'ws'
import {createProxyMiddleware} from 'http-proxy-middleware'

import getOrCreateFile from '../utilities/get-or-create-file.js'
import randomToken from '../utilities/random-token.js'

import type Umbreld from '../../index.js'
import * as jwt from '../jwt.js'
import {trpcHandler} from './trpc/index.js'
import createTerminalWebSocketHandler from './terminal-socket.js'

import fileApi from '../files/api.js'

export type ServerOptions = {umbreld: Umbreld}

export type ApiOptions = {
	publicApi: express.Router
	privateApi: express.Router
	umbreld: Umbreld
}

// Safely wrapps async request handlers in logic to catch errors and pass them to the errror handling middleware
const asyncHandler = (
	handler: (request: express.Request, response: express.Response, next: express.NextFunction) => Promise<any>,
) =>
	function asyncHandlerWrapper(request: express.Request, response: express.Response, next: express.NextFunction) {
		return Promise.resolve(handler(request, response, next)).catch(next)
	}

// Iterate over all routes and wrap them in an async handler
const wrapHandlersWithAsyncHandler = (router: express.Router) => {
	// Loop over each layer of the router stack
	for (const layer of router.stack) {
		// If we have a nested router, recursively wrap its handlers
		if (layer.name === 'router') wrapHandlersWithAsyncHandler(layer.handle)
		// If we have a route, wrap its handlers
		else if (layer.route) {
			for (const routeLayer of layer.route.stack) routeLayer.handle = asyncHandler(routeLayer.handle)
		}
	}
}

class Server {
	umbreld: Umbreld
	logger: Umbreld['logger']
	port: number | undefined

	constructor({umbreld}: ServerOptions) {
		this.umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	async getJwtSecret() {
		const jwtSecretPath = `${this.umbreld.dataDirectory}/secrets/jwt`
		return getOrCreateFile(jwtSecretPath, randomToken(256))
	}

	async signToken() {
		return jwt.sign(await this.getJwtSecret())
	}

	async signProxyToken() {
		return jwt.signProxyToken(await this.getJwtSecret())
	}

	async verifyToken(token: string) {
		return jwt.verify(token, await this.getJwtSecret())
	}

	async verifyProxyToken(token: string) {
		return jwt.verifyProxyToken(token, await this.getJwtSecret())
	}

	async start() {
		// Ensure the JWT secret exists
		await this.getJwtSecret()

		// Create the handler
		const app = express()

		// Setup cookie parser
		app.use(cookieParser())

		// Security hardening, CSP
		app.use(
			helmet.contentSecurityPolicy({
				directives: {
					// Allow inline scripts ONLY in development for vite dev server
					scriptSrc: this.umbreld.developmentMode ? ["'self'", "'unsafe-inline'"] : null,
					// Allow 3rd party app images (remove this if we serve them locally in the future)
					// Also allow blob: URLs for images being uploaded in Files (since their thumbnails don't exist yet)
					imgSrc: ['*', 'blob:'],
					// Allow fetching data from our apps API (e.g., for Discover page in App Store)
					connectSrc: ["'self'", 'https://apps.umbrel.com'],
					// Allow plain text access over the local network
					upgradeInsecureRequests: null,
				},
			}),
		)
		app.use(helmet.referrerPolicy({policy: 'no-referrer'}))
		app.disable('x-powered-by')

		// Attach the umbreld and logger instances so they're accessible to routes
		app.set('umbreld', this.umbreld)
		app.set('logger', this.logger)

		// Log requests
		app.use((request, response, next) => {
			this.logger.verbose(`${request.method} ${request.path}`)
			next()
		})

		// This is needed for legacy reasons when 0.5.x users OTA update to 1.0.
		// 0.5.x polls this endpoint during update to know when it's completed.
		app.get('/manager-api/v1/system/update-status', (request, response) => {
			response.json({state: 'success', progress: 100, description: '', updateTo: ''})
		})

		// Handle tRPC routes
		app.use('/trpc', trpcHandler)

		// Handle API routes
		const createApi = (registerApi: ({publicApi, privateApi, umbreld}: ApiOptions) => void) => {
			// Create public and private routers
			const publicApi = express.Router()
			const privateApi = express.Router()
			privateApi.use(async (request, response, next) => {
				const token = request?.cookies?.UMBREL_PROXY_TOKEN
				const isValid = await this.verifyProxyToken(token).catch(() => false)
				if (!isValid) return response.status(401).json({error: 'unauthorized'})

				next()
			})

			// Register API handlers
			registerApi({publicApi, privateApi, umbreld: this.umbreld})

			// Mount the public and private on a single router
			const api = express.Router()
			api.use(publicApi)
			api.use(privateApi)

			return api
		}
		app.use('/api/files', createApi(fileApi))

		// Handle log file downloads
		app.get('/logs/', async (request, response) => {
			// Check the user is logged in
			try {
				// We shouldn't really use the proxy token for this but it's
				// fine until we have subdomains and refactor to session cookies
				await this.verifyProxyToken(request?.cookies?.UMBREL_PROXY_TOKEN)
			} catch (error) {
				return response.status(401).send('Unauthorized')
			}

			try {
				// Force the browser to treat the request as a file download
				response.set('Content-Disposition', `attachment;filename=umbrel-${Date.now()}.log.gz`)
				const journal = $`journalctl`
				await pipeline(journal.stdout!, createGzip(), response)
			} catch (error) {
				this.logger.error(`Error streaming logs: ${(error as Error).message}`)
			}
		})

		// If we have no API route hits then serve the ui at the root.
		// We proxy through to the ui dev server during development with
		// process.env.UMBREL_UI_PROXY otherwise in production we
		// statically serve the built ui.
		if (process.env.UMBREL_UI_PROXY) {
			app.use(
				'/',
				createProxyMiddleware({
					target: process.env.UMBREL_UI_PROXY,
					ws: true,
					logProvider: () => ({
						log: this.logger.verbose,
						debug: this.logger.verbose,
						info: this.logger.verbose,
						warn: this.logger.verbose,
						error: this.logger.error,
					}),
				}),
			)
		} else {
			const currentFilename = fileURLToPath(import.meta.url)
			const currentDirname = dirname(currentFilename)
			const uiPath = join(currentDirname, '../../../ui')

			// Built assets include a hash of the contents in the filename and
			// wallpapers do not ever change, so we can cache these aggressively
			const cacheAggressively: express.RequestHandler = (_, response, next) => {
				const approximatelyOneYearInSeconds = 365 * 24 * 60 * 60 // RFC 2616, 14.21
				response.set('Cache-Control', `public, max-age=${approximatelyOneYearInSeconds}, immutable`)
				next()
			}
			app.get('/assets/*', cacheAggressively)
			app.get('/wallpapers/*', cacheAggressively)

			// Other files without a hash in their filename should revalidate based on
			// ETag and Last-Modified instead to force the browser to automatically
			// refresh their contents after an OTA update for example.
			const staticOptions = {cacheControl: true, etag: true, lastModified: true, maxAge: 0}
			app.use('/', express.static(uiPath, staticOptions))
			app.use('*', express.static(`${uiPath}/index.html`, staticOptions))
		}

		// All errors should be handled by their own middleware but if they aren't we'll catch
		// them here and log them.
		app.use((error: Error, request: express.Request, response: express.Response, next: express.NextFunction): void => {
			this.logger.error(`${request.method} ${request.path} ${error.message}`)
			if (response.headersSent) return
			response.status(500).json({error: true})
		})

		// Wrap all request handlers with a safe async handler
		// TODO: We can remove this if we move to express 5
		wrapHandlersWithAsyncHandler(app._router)

		// Start the server
		const server = http.createServer(app)
		const listen = promisify(server.listen.bind(server)) as (port: number) => Promise<void>
		await listen(this.umbreld.port)
		this.port = (server.address() as any).port
		this.logger.log(`Listening on port ${this.port}`)

		// Create the terminal WebSocket server
		const terminalLogger = this.logger.createChildLogger('terminal')
		const wss = new WebSocketServer({noServer: true})
		wss.on('connection', createTerminalWebSocketHandler({umbreld: this.umbreld, logger: terminalLogger}))

		// Handle WebSocket upgrade requests
		server.on('upgrade', async (request, socket, head) => {
			// Only handle requests to /terminal
			const {pathname} = new URL(`https://localhost${request.url}`)
			if (pathname === '/terminal') {
				// Verify the auth token before doing anything
				const token = new URL(`https://localhost/${request.url}`).searchParams.get('token')
				try {
					if (await this.verifyToken(token!)) {
						// Upgrade connection to WebSocket and fire the connection handler
						wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
					}
				} catch (error) {
					terminalLogger.error(`Error creating socket: ${(error as Error).message}`)
					socket.destroy()
				}
			}
		})

		return this
	}
}

export default Server
