import CryptoKit
import Foundation
import UmbrelKit

// Stale-while-revalidate snapshot of the data Home renders, isolated by account.
// Written on every successful load (and prefetched during onboarding's Connected
// screen), read synchronously when a device opens — so Home paints complete on its
// first frame and the skeleton/cascade only ever shows when there's no snapshot yet.
struct DeviceDataSnapshot: Codable {
	var apps: [Umbreld.AppSummary]
	var disk: Umbreld.DiskUsage?
	var favoritePaths: [String]
	var updatableApps: [String]
}

@MainActor
enum DeviceDataStore {
	private static var directory: URL {
		let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
		// This cache is disposable, so use a new namespace rather than resolving
		// legacy paths built from server-provided identifiers.
		let dir = caches.appendingPathComponent("device-data-v2", isDirectory: true)
		try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		return dir
	}

	static func load(deviceId: String, accountId: String) -> DeviceDataSnapshot? {
		guard let data = try? Data(contentsOf: fileURL(deviceId: deviceId, accountId: accountId)) else { return nil }
		return try? JSONDecoder().decode(DeviceDataSnapshot.self, from: data)
	}

	static func save(_ snapshot: DeviceDataSnapshot, deviceId: String, accountId: String) {
		let cacheSnapshot = DeviceDataSnapshot(
			apps: snapshot.apps.map(\.withoutCredentials),
			disk: snapshot.disk,
			favoritePaths: snapshot.favoritePaths,
			updatableApps: snapshot.updatableApps
		)
		guard let data = try? JSONEncoder().encode(cacheSnapshot) else { return }
		let file = fileURL(deviceId: deviceId, accountId: accountId)
		try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
		try? data.write(to: file, options: .atomic)
	}

	static func delete(deviceId: String) {
		try? FileManager.default.removeItem(
			at: directory.appendingPathComponent(cacheKey(deviceId), isDirectory: true)
		)
	}

	private static func fileURL(deviceId: String, accountId: String) -> URL {
		directory
			.appendingPathComponent(cacheKey(deviceId), isDirectory: true)
			.appendingPathComponent(cacheKey(accountId))
			.appendingPathExtension("json")
	}

	// Device and account ids arrive from a remote endpoint. Hashing gives every
	// possible value one flat, fixed-width filename instead of interpreting path
	// separators or dot segments supplied by that endpoint.
	private static func cacheKey(_ value: String) -> String {
		SHA256.hash(data: Data(value.utf8))
			.map { String(format: "%02x", $0) }
			.joined()
	}
}
