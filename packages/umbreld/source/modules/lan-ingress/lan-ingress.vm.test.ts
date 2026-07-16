import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import getPort from 'get-port'
import got from 'got'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

type TestVm = Awaited<ReturnType<typeof createTestVm>>

describe.sequential('LAN ingress', () => {
	let umbreld: TestVm
	let failed = false
	let httpsPort: number
	let authPort: number
	let appProxyPort: number
	let bridgeAppPort: number
	let hostNetworkAppPort: number
	let caCertificate = ''
	let caFingerprint = ''
	let ingressRefreshHostnameIndex = 0

	beforeAll(async () => {
		// Cover the fixed LAN ingress listeners plus each app routing shape.
		const forwardedPorts = {
			https: {hostPort: await getPort({host: '127.0.0.1'}), guestPort: 443},
			auth: {hostPort: await getPort({host: '127.0.0.1'}), guestPort: 2000},
			appProxy: {hostPort: await getPort({host: '127.0.0.1'}), guestPort: 9091},
			bridgeApp: {hostPort: await getPort({host: '127.0.0.1'}), guestPort: 9092},
			hostNetworkApp: {hostPort: await getPort({host: '127.0.0.1'}), guestPort: 9093},
		}
		httpsPort = forwardedPorts.https.hostPort
		authPort = forwardedPorts.auth.hostPort
		appProxyPort = forwardedPorts.appProxy.hostPort
		bridgeAppPort = forwardedPorts.bridgeApp.hostPort
		hostNetworkAppPort = forwardedPorts.hostNetworkApp.hostPort

		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: Object.values(forwardedPorts),
		})
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('boots VM and registers user', async () => {
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	test('reports HTTPS access certificate status', async () => {
		await expect(umbreld.unauthenticatedClient.lanIngress.getCertificateStatus.query()).rejects.toThrow('Invalid token')

		const status = await umbreld.client.lanIngress.getCertificateStatus.query()
		expect(status.caCertificate).toContain('BEGIN CERTIFICATE')
		expect(status.caFingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
		expect(new Date(status.caExpiresAt).getTime()).toBeGreaterThan(Date.now())
		expect(status.serverSans.dns).toContain('umbrel.local')
		expect(status.serverSans.ips).toContain('127.0.0.1')
		caCertificate = status.caCertificate
		caFingerprint = status.caFingerprint

		await expectIngressResponds(`https://127.0.0.1:${httpsPort}/`, caCertificate)
		await expectIngressResponds(`http://127.0.0.1:${authPort}/`)
		await expectIngressResponds(`https://127.0.0.1:${authPort}/`, caCertificate)
	})

	test('resets the local CA without breaking dashboard or auth ingress', async () => {
		const status = await umbreld.client.lanIngress.resetCa.mutate()
		expect(status.caCertificate).toContain('BEGIN CERTIFICATE')
		expect(status.caCertificate).not.toBe(caCertificate)
		expect(status.caFingerprint).not.toBe(caFingerprint)
		expect(status.serverSans.dns).toContain('umbrel.local')
		expect(status.serverSans.ips).toContain('127.0.0.1')
		caCertificate = status.caCertificate
		caFingerprint = status.caFingerprint

		await expectIngressResponds(`https://127.0.0.1:${httpsPort}/`, caCertificate)
		await expectIngressResponds(`https://127.0.0.1:${authPort}/`, caCertificate)
	})

	test('keeps the local CA after umbreld restart', async () => {
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.login()

		const status = await umbreld.client.lanIngress.getCertificateStatus.query()
		expect(status.caCertificate).toBe(caCertificate)
		expect(status.caFingerprint).toBe(caFingerprint)

		await expectIngressResponds(`https://127.0.0.1:${httpsPort}/`, caCertificate)
		await expectIngressResponds(`https://127.0.0.1:${authPort}/`, caCertificate)
	})

	test('sets up test apps', async () => {
		// setupTestApps only writes app state over SSH; it does not trigger a LAN ingress
		// refresh. The hostname test below causes the refresh (setHostname awaits it) that
		// creates the app mux listeners and nftables rules the app-port test depends on.
		// If these tests are reordered, trigger a refresh explicitly or the app-port test
		// will race the 1 minute periodic refresh.
		await setupTestApps(umbreld)
	})

	test('updates certificate SANs when hostname changes', async () => {
		const hostname = await changeHostnameAndRefreshIngress(umbreld, ingressRefreshHostnameIndex++)
		const status = await umbreld.client.lanIngress.getCertificateStatus.query()
		expect(status.serverSans.dns).toContain(hostname)
		expect(status.serverSans.dns).toContain(`${hostname}.local`)
	})

	test('keeps app-proxy, bridge, and host-network app ports working over HTTP and HTTPS', async () => {
		await expectAppPortSupportsHttpAndHttps({app: 'app-proxy', port: appProxyPort, caCertificate})
		await expectAppPortSupportsHttpAndHttps({app: 'bridge', port: bridgeAppPort, caCertificate})
		await expectAppPortSupportsHttpAndHttps({app: 'host-network', port: hostNetworkAppPort, caCertificate})
		await expectAppHstsStripped(`https://127.0.0.1:${bridgeAppPort}/bridge/hsts`, caCertificate)

		const nftRules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		expect(nftRules).toContain('redirect to')
		for (const port of [9091, 9092, 9093]) {
			expect(nftRules).toContain(`tcp dport ${port}`)
			expect(nftRules).toContain(`ct original proto-dst != ${port} drop`)
		}
	})

	test('removes app ingress when the app is no longer installed', async () => {
		await removeTestApps(umbreld)
		await changeHostnameAndRefreshIngress(umbreld, ingressRefreshHostnameIndex++)

		const nftRules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		for (const port of [9091, 9092, 9093]) {
			expect(nftRules).not.toContain(`tcp dport ${port}`)
			expect(nftRules).not.toContain(`ct original proto-dst != ${port} drop`)
		}
	})
})

async function expectIngressResponds(url: string, caCertificate?: string) {
	return pRetry(
		async () => {
			const response = await got(url, {
				https: caCertificate ? {certificateAuthority: caCertificate} : undefined,
				retry: {limit: 0},
				throwHttpErrors: false,
			})
			if (response.statusCode >= 500) throw new Error(`Expected ${url} to be available, got ${response.statusCode}`)
			return response
		},
		{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

// The synthetic app server echoes request metadata so we can assert what
// reached the app after LAN ingress handled the connection.
async function requestAppEcho(url: string, caCertificate?: string) {
	return pRetry(
		() =>
			got(url, {
				https: caCertificate ? {certificateAuthority: caCertificate} : undefined,
				retry: {limit: 0},
			}).json<{app: string; url: string; headers: Record<string, string | undefined>}>(),
		{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

async function expectAppPortSupportsHttpAndHttps({
	app,
	port,
	caCertificate,
}: {
	app: string
	port: number
	caCertificate: string
}) {
	const httpResponse = await requestAppEcho(`http://127.0.0.1:${port}/${app}/http`)
	expect(httpResponse.app).toBe(app)
	expect(httpResponse.url).toBe(`/${app}/http`)
	expect(httpResponse.headers['x-forwarded-proto']).toBeUndefined()

	const httpsResponse = await requestAppEcho(`https://127.0.0.1:${port}/${app}/https`, caCertificate)
	expect(httpsResponse.app).toBe(app)
	expect(httpsResponse.url).toBe(`/${app}/https`)
	expect(httpsResponse.headers['x-forwarded-proto']).toBe('https')
	// Apps must not receive X-Forwarded-For: some (e.g. Home Assistant) reject any
	// request carrying it from a proxy they haven't been configured to trust.
	expect(httpsResponse.headers['x-forwarded-for']).toBeUndefined()
}

async function expectAppHstsStripped(url: string, caCertificate: string) {
	const response = await pRetry(
		() =>
			got(url, {
				https: {certificateAuthority: caCertificate},
				retry: {limit: 0},
			}),
		{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
	expect(response.headers['strict-transport-security']).toBeUndefined()
}

async function changeHostnameAndRefreshIngress(umbreld: TestVm, index: number) {
	const hostname = `umbrel-ingress-${index}`
	await umbreld.client.system.setHostname.mutate({hostname})
	return hostname
}

// Create the smallest installed-app shapes needed to exercise LAN ingress
// routing without pulling real apps from the app store.
async function setupTestApps(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot(`
set -eu

write_app() {
	app_id="$1"
	app_name="$2"
	app_port="$3"
	compose_kind="$4"
	app_dir="/home/umbrel/umbrel/app-data/$app_id"
	mkdir -p "$app_dir"

	cat > "$app_dir/umbrel-app.yml" <<YAML
manifestVersion: 1.0.0
id: $app_id
name: $app_name
tagline: Test app
category: Development
version: "1.0.0"
port: $app_port
description: Test app
website: https://umbrel.com
support: https://umbrel.com
gallery: []
YAML

	case "$compose_kind" in
		app_proxy)
			cat > "$app_dir/docker-compose.yml" <<'YAML'
services:
  app_proxy: {}
YAML
			;;
		bridge)
			cat > "$app_dir/docker-compose.yml" <<YAML
services:
  web:
    ports:
      - "$app_port:$app_port"
YAML
			;;
		host)
			cat > "$app_dir/docker-compose.yml" <<'YAML'
services:
  web:
    network_mode: host
YAML
			;;
	esac
}

write_app lan-ingress-app-proxy "LAN Ingress App Proxy" 9091 app_proxy
write_app lan-ingress-bridge "LAN Ingress Bridge" 9092 bridge
write_app lan-ingress-host "LAN Ingress Host" 9093 host

cat > /tmp/lan-ingress-test-server.js <<'JS'
const http = require('http')

function listen(app, port) {
	http.createServer((request, response) => {
		response.setHeader('content-type', 'application/json')
		if (request.url.includes('/hsts')) response.setHeader('strict-transport-security', 'max-age=31536000')
		response.end(JSON.stringify({
			app,
			url: request.url,
			headers: {
				'x-forwarded-for': request.headers['x-forwarded-for'],
				'x-forwarded-host': request.headers['x-forwarded-host'],
				'x-forwarded-proto': request.headers['x-forwarded-proto'],
			},
		}))
	}).listen(port, '0.0.0.0')
}

listen('app-proxy', 9091)
listen('bridge', 9092)
listen('host-network', 9093)
JS

node - <<'NODE'
const fs = require('fs')
const yaml = require('/opt/umbreld/node_modules/js-yaml')

const storePath = '/home/umbrel/umbrel/umbrel.yaml'
const store = yaml.load(fs.readFileSync(storePath, 'utf8')) || {}
store.apps = ['lan-ingress-app-proxy', 'lan-ingress-bridge', 'lan-ingress-host']
fs.writeFileSync(storePath, yaml.dump(store))
NODE

if [ -f /tmp/lan-ingress-test-server.pid ]; then
	kill "$(cat /tmp/lan-ingress-test-server.pid)" 2>/dev/null || true
fi
nohup node /tmp/lan-ingress-test-server.js >/tmp/lan-ingress-test-server.log 2>&1 &
echo "$!" > /tmp/lan-ingress-test-server.pid
`)
}

async function removeTestApps(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot(`
set -eu

node - <<'NODE'
const fs = require('fs')
const yaml = require('/opt/umbreld/node_modules/js-yaml')

const storePath = '/home/umbrel/umbrel/umbrel.yaml'
const store = yaml.load(fs.readFileSync(storePath, 'utf8')) || {}
store.apps = []
fs.writeFileSync(storePath, yaml.dump(store))
NODE

rm -rf /home/umbrel/umbrel/app-data/lan-ingress-app-proxy
rm -rf /home/umbrel/umbrel/app-data/lan-ingress-bridge
rm -rf /home/umbrel/umbrel/app-data/lan-ingress-host
if [ -f /tmp/lan-ingress-test-server.pid ]; then
	kill "$(cat /tmp/lan-ingress-test-server.pid)" 2>/dev/null || true
	rm -f /tmp/lan-ingress-test-server.pid
fi
`)
}
