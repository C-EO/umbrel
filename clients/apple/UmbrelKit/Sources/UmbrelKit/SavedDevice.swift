import Foundation

public struct SavedAccountProfile: Codable, Equatable, Sendable {
	public var name: String
	public var wallpaperId: String
	public var wallpaperBrandColorHsl: String?
	public var role: String

	public init(name: String, wallpaperId: String, wallpaperBrandColorHsl: String? = nil, role: String) {
		self.name = name
		self.wallpaperId = wallpaperId
		self.wallpaperBrandColorHsl = wallpaperBrandColorHsl
		self.role = role
	}
}

public enum BrowserConnectionPreference: String, Codable, Equatable, Sendable {
	case automatic
	case localNetwork
	case tailscale
}

// Persisted shape of a saved device. Native grants live in the Keychain, never here.
public struct SavedDevice: Codable, Equatable, Sendable {
	public var id: String
	public var name: String
	public var host: String
	public var addresses: [String]
	public var model: String?
	public var userName: String?
	// Cached wallpaper ID for rendering the device card while offline.
	public var wallpaperId: String?
	// Identity and wallpaper belong to an account, not to the physical Umbrel. The
	// top-level fields cache the last-used presentation for device lists.
	public var accountProfiles: [String: SavedAccountProfile]?
	// Non-secret picker preference. It changes only after a successful login, so
	// browsing the account dock never changes who is selected next time.
	public var lastAccountId: String?
	// Browser preferences are presentation-only. The connection controls which
	// kind of address the app chooses when opening the Umbrel in a browser.
	public var browserConnection: BrowserConnectionPreference?
	public var dashboardUsesHTTPS: Bool?
	public var suppressHTTPSRequiredAppWarning: Bool?

	public init(
		id: String,
		name: String,
		host: String,
		addresses: [String],
		model: String? = nil,
		userName: String? = nil,
		wallpaperId: String? = nil,
		accountProfiles: [String: SavedAccountProfile]? = nil,
		lastAccountId: String? = nil,
		browserConnection: BrowserConnectionPreference? = nil,
		dashboardUsesHTTPS: Bool? = nil,
		suppressHTTPSRequiredAppWarning: Bool? = nil
	) {
		self.id = id
		self.name = name
		self.host = host
		self.addresses = addresses
		self.model = model
		self.userName = userName
		self.wallpaperId = wallpaperId
		self.accountProfiles = accountProfiles
		self.lastAccountId = lastAccountId
		self.browserConnection = browserConnection
		self.dashboardUsesHTTPS = dashboardUsesHTTPS
		self.suppressHTTPSRequiredAppWarning = suppressHTTPSRequiredAppWarning
	}

	public func accountProfile(for accountId: String) -> SavedAccountProfile? {
		accountProfiles?[accountId]
	}

	// Every address must still prove the stable discovery id before use. LAN routes
	// additionally use the device's pinned CA; Tailscale routes rely on the authenticated,
	// encrypted tailnet. It remains one Umbrel account with multiple possible routes.
	public var connectionHosts: [String] {
		var seen = Set<String>()
		return ([host] + addresses)
			.filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
	}

	public var nativeTarget: Umbreld.Target {
		Umbreld.Target(deviceId: id, hosts: connectionHosts)
	}

	public static func isTailscaleAddress(_ address: String) -> Bool {
		guard let octets = ipv4Octets(address) else { return false }
		return octets[0] == 100 && (64...127).contains(octets[1])
	}

	public static func isIPv4Address(_ address: String) -> Bool {
		ipv4Octets(address) != nil
	}

	private static func ipv4Octets(_ address: String) -> [Int]? {
		let parts = address.split(separator: ".", omittingEmptySubsequences: false)
		guard parts.count == 4 else { return nil }
		let octets = parts.compactMap { part -> Int? in
			guard !part.isEmpty,
				(part.count == 1 || part.first != "0"),
				part.allSatisfy(\.isNumber),
				let value = Int(part),
				value <= 255
			else { return nil }
			return value
		}
		return octets.count == 4 ? octets : nil
	}

	public static func isBonjourHostname(_ host: String) -> Bool {
		host.lowercased().hasSuffix(".local")
	}

	// PhotoKit stores one literal destination in every background job. Select only an
	// address from Tailscale's CGNAT range; setup verifies and pins that exact endpoint.
	// Prefer the Umbrel's reported addresses over a canonical host retained from pairing,
	// because a reset/reinstall can give the same Umbrel a new Tailscale node address.
	public var photoBackupHost: String? {
		addresses.first(where: Self.isTailscaleAddress)
			?? (Self.isTailscaleAddress(host) ? host : nil)
	}

	// Only an IdentifiedDevice has proved the stable discovery id through the saved
	// Umbrel's HTTPS identity. Its answering endpoint becomes primary, while stale
	// Bonjour names are discarded and current IP candidates remain as fallbacks.
	public mutating func mergeVerifiedDiscovery(_ discovered: IdentifiedDevice) {
		guard discovered.id == id else { return }
		host = discovered.host
		addresses.removeAll(where: Self.isBonjourHostname)
		rememberConnectionCandidates(discovered.addresses)
		name = discovered.name
		model = discovered.model
	}

	// Discovery can reveal a working route before the app is authenticated. Keep it as
	// a candidate, but don't let a partial discovery snapshot erase other known routes.
	public mutating func rememberConnectionCandidates(_ candidates: [String]) {
		addresses = Self.uniqueAddresses(addresses + candidates)
	}

	// Once authenticated, the Umbrel itself is the authority on its current addresses.
	// Callers only invoke this after system.getIpAddresses succeeds, so a failed refresh
	// naturally leaves the last known list untouched.
	public mutating func replaceAvailableAddresses(_ current: [String]) {
		addresses = Self.uniqueAddresses(current)
	}

	private static func uniqueAddresses(_ values: [String]) -> [String] {
		var seen = Set<String>()
		return values.filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
	}

	public mutating func saveAccountProfile(
		accountId: String,
		name: String,
		wallpaperId: String,
		wallpaperBrandColorHsl: String? = nil,
		role: String
	) {
		var profiles = accountProfiles ?? [:]
		profiles[accountId] = SavedAccountProfile(
			name: name,
			wallpaperId: wallpaperId,
			wallpaperBrandColorHsl: wallpaperBrandColorHsl,
			role: role
		)
		accountProfiles = profiles
		lastAccountId = accountId
		// Device cards deliberately show the last-used account while signed out.
		userName = name
		self.wallpaperId = wallpaperId
	}

	// Includes the user's name when available (e.g. "Patrick's Umbrel Home").
	public var displayName: String { userName.map { "\($0)\u{2019}s \(model ?? name)" } ?? (model ?? name) }
}
