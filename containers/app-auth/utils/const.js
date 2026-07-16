function readFromEnvOrTerminate(key) {
	const value = process.env[key];

	if(typeof(value) !== "string" || value.trim().length === 0) {
		console.error(`The env. variable '${key}' is not set. Terminating...`);

		process.exit(0);
	}

	return value;
}

const UMBREL_GATEWAY_IP = "10.21.0.1";

module.exports = Object.freeze({
	// The HTTPS proxy token uses the browser-enforced __Host- prefix. Any code
	// setting this cookie must include Secure, Path=/, and no Domain attribute.
	UMBREL_COOKIE_NAME: "__Host-UMBREL_PROXY_TOKEN_HTTPS",
	UMBREL_HTTP_COOKIE_NAME: "UMBREL_PROXY_TOKEN",
	UMBREL_GATEWAY_IP,
	TRUSTED_PROXY_IPS: ["loopback", UMBREL_GATEWAY_IP],

	LOG_LEVEL: process.env.LOG_LEVEL || "info",

	PORT: parseInt(process.env.PORT) || 2000,

	UMBREL_AUTH_SECRET: readFromEnvOrTerminate("UMBREL_AUTH_SECRET"),

	TOR_PATH: process.env.TOR_PATH || "/var/lib/tor",
	APP_DATA_PATH: process.env.APP_DATA_PATH || "/app-data",

	MANAGER_IP: readFromEnvOrTerminate("MANAGER_IP"),
	MANAGER_PORT: parseInt(readFromEnvOrTerminate("MANAGER_PORT")),

	DASHBOARD_IP: readFromEnvOrTerminate("DASHBOARD_IP"),
	DASHBOARD_PORT: parseInt(readFromEnvOrTerminate("DASHBOARD_PORT")),
});
