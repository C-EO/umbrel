import Foundation

public struct PhotoBackupPreference: Codable, Equatable {
	public var includesPhotos: Bool
	public var includesVideos: Bool
	public var allowsCellular: Bool

	public init(
		includesPhotos: Bool = false,
		includesVideos: Bool = false,
		allowsCellular: Bool = false
	) {
		self.includesPhotos = includesPhotos
		self.includesVideos = includesVideos
		self.allowsCellular = allowsCellular
	}

	public var isEnabled: Bool { includesPhotos || includesVideos }
}

// User intent can outlive a session, but it belongs to one account on one Umbrel.
// Runtime PhotoKit configuration remains singular; activeTarget records which saved
// preference is currently allowed to drive that one system extension.
public struct PhotoBackupPreferenceTarget: Codable, Equatable, Sendable {
	public let deviceId: String
	public let accountId: String

	public init(deviceId: String, accountId: String) {
		self.deviceId = deviceId
		self.accountId = accountId
	}
}

@MainActor
public enum PhotoBackupPreferenceStore {
	private struct State: Codable {
		var preferences: [String: [String: PhotoBackupPreference]] = [:]
		var activeTarget: PhotoBackupPreferenceTarget?
	}

	private static let storageKey = "photoBackupPreferences.v1"

	public static func preference(
		deviceId: String,
		accountId: String,
		defaults: UserDefaults = .standard
	) -> PhotoBackupPreference {
		loadState(defaults: defaults).preferences[deviceId]?[accountId] ?? PhotoBackupPreference()
	}

	public static func save(
		_ preference: PhotoBackupPreference,
		deviceId: String,
		accountId: String,
		activate: Bool,
		defaults: UserDefaults = .standard
	) {
		var state = loadState(defaults: defaults)
		var accounts = state.preferences[deviceId] ?? [:]
		accounts[accountId] = preference
		state.preferences[deviceId] = accounts
		let target = PhotoBackupPreferenceTarget(deviceId: deviceId, accountId: accountId)
		if activate, preference.isEnabled {
			state.activeTarget = target
		} else if !preference.isEnabled, state.activeTarget == target {
			state.activeTarget = nil
		}
		saveState(state, defaults: defaults)
	}

	public static func isActive(
		deviceId: String,
		accountId: String,
		defaults: UserDefaults = .standard
	) -> Bool {
		loadState(defaults: defaults).activeTarget
			== PhotoBackupPreferenceTarget(deviceId: deviceId, accountId: accountId)
	}

	public static func activeTarget(
		defaults: UserDefaults = .standard
	) -> PhotoBackupPreferenceTarget? {
		loadState(defaults: defaults).activeTarget
	}

	// A live configuration proves which account currently owns PhotoKit's uploader.
	// Repair only that index after an interrupted handoff; the user's saved media
	// choices remain untouched and continue to drive the next sync.
	public static func reconcileActiveTarget(
		deviceId: String,
		accountId: String,
		defaults: UserDefaults = .standard
	) {
		var state = loadState(defaults: defaults)
		let target = PhotoBackupPreferenceTarget(deviceId: deviceId, accountId: accountId)
		guard state.preferences[deviceId]?[accountId]?.isEnabled == true,
			state.activeTarget != target
		else { return }
		state.activeTarget = target
		saveState(state, defaults: defaults)
	}

	public static func removeDevice(_ deviceId: String, defaults: UserDefaults = .standard) {
		var state = loadState(defaults: defaults)
		state.preferences.removeValue(forKey: deviceId)
		if state.activeTarget?.deviceId == deviceId { state.activeTarget = nil }
		saveState(state, defaults: defaults)
	}

	private static func loadState(defaults: UserDefaults) -> State {
		guard let data = defaults.data(forKey: storageKey),
			let state = try? JSONDecoder().decode(State.self, from: data)
		else { return State() }
		return state
	}

	private static func saveState(_ state: State, defaults: UserDefaults) {
		guard let data = try? JSONEncoder().encode(state) else { return }
		defaults.set(data, forKey: storageKey)
	}
}
