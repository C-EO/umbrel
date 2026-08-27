// This must be in it's own file otherwise the frontend tries to import
// loads of stuff from the backend and blows up.

// Export the router type for use in clients in other packages
export type {AppRouter} from './index.js'

// RPCs that MUST use HTTP (cookie/header semantics). Clients use this list for split-link routing.
export const httpOnlyPaths = [
	// sets cookie
	'user.login',
	// native auth exchanges read request metadata and set no-store response headers
	'user.loginNative',
	'user.refreshNativeAccess',
	// reads the Authorization header and browser-session cookie
	'user.isLoggedIn',
	// extends the session and its browser-session cookie
	'user.renewToken',
	// exchanges the Authorization header for a one-time WebSocket ticket
	'user.createWebSocketTicket',
	// returns the stable URL token paired with the browser-session cookie
	'user.getHttpApiToken',
	// may revoke the calling session and must deliver cookie clears before its WebSocket closes
	'user.revokeSession',
	'user.revokeOtherSessions',
	// clears cookie
	'user.logout',
	// system.status doesn't use cookies/headers, but the UI polls it across restarts to detect when umbreld is back online; we force HTTP to avoid WS reconnect handshake
	'system.status',
	// bootstraps local HTTPS trust and sets a no-store response header
	'system.localHttpsIdentity',
] as const
