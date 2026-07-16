import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {existsSync} from 'node:fs'

import {$} from 'execa'

import type Umbreld from '../../../index.js'

export default async function appEnvironment(umbreld: Umbreld, command: string) {
	let inheritStdio = true
	// Prevent breaking test output
	if (process.env.TEST === 'true') inheritStdio = false

	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	// TODO: Remove this override source path after publishing app-auth/app-proxy images with the LAN ingress changes.
	const containerSourceDirectory = existsSync('/umbrel-dev/containers') ? '/umbrel-dev/containers' : '/opt/containers'
	const composePath = join(currentDirname, 'docker-compose.yml')
	const torEnabled = await umbreld.store.get('torEnabled')
	const options = {
		stdio: inheritStdio ? 'inherit' : 'pipe',
		cwd: umbreld.dataDirectory,
		env: {
			UMBREL_DATA_DIR: umbreld.dataDirectory,
			// TODO: Load these from somewhere more appropriate
			NETWORK_IP: '10.21.0.0',
			GATEWAY_IP: '10.21.0.1',
			MANAGER_IP: '10.21.21.4',
			AUTH_IP: '10.21.21.6',
			AUTH_PORT: '2000',
			AUTH_BIND_IP: '127.0.0.1',
			AUTH_PUBLISHED_PORT: '22000',
			TOR_PROXY_IP: '10.21.21.11',
			TOR_PROXY_PORT: '9050',
			TOR_PASSWORD: 'mLcLDdt5qqMxlq3wv8Din3UD44bTZHzRFhIktw38kWg=',
			TOR_HASHED_PASSWORD: '16:158FBE422B1A9D996073BE2B9EC38852C70CE12362CA016F8F6859C426',
			UMBREL_AUTH_SECRET: 'DEADBEEF', // Not used, just left in for compatibility reasons
			JWT_SECRET: await umbreld.server.getJwtSecret(),
			// app-auth runs in Docker; reach umbreld through LAN ingress because umbreld itself is loopback-only.
			UMBRELD_RPC_HOST: 'host.docker.internal:80',
			UMBREL_CONTAINER_SOURCE_DIR: containerSourceDirectory,
			UMBREL_LEGACY_COMPAT_DIR: currentDirname,
			UMBREL_TORRC: torEnabled ? `${currentDirname}/tor-server-torrc` : `${currentDirname}/tor-proxy-torrc`,
		},
	}
	if (command === 'up') {
		await $(
			options as any,
		)`docker compose --project-name umbrel --file ${composePath} ${command} --build --detach --remove-orphans`
	} else {
		await $(options as any)`docker compose --project-name umbrel --file ${composePath} ${command}`
	}
}
