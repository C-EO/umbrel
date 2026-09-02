import CryptoKit
import UIKit
import XCTest
@testable import Umbrel

final class SecurityRegressionTests: XCTestCase {
	@MainActor
	func testRemoteIdentifiersCannotEscapeTheDeviceCacheNamespace() throws {
		let fileManager = FileManager.default
		let caches = try XCTUnwrap(fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first)
		let namespace = caches.appendingPathComponent("device-data-v2", isDirectory: true)
		let sentinel = caches.appendingPathComponent("security-regression-\(UUID().uuidString)")
		let sentinelData = Data("keep".utf8)
		try sentinelData.write(to: sentinel)
		defer { try? fileManager.removeItem(at: sentinel) }

		let deviceId = "../../Application Support/escaped-device"
		let accountId = "../../../Documents/config"
		let deviceDirectory = namespace.appendingPathComponent(cacheKey(deviceId), isDirectory: true)
		let expectedFile = deviceDirectory
			.appendingPathComponent(cacheKey(accountId))
			.appendingPathExtension("json")
		defer { try? fileManager.removeItem(at: deviceDirectory) }

		let snapshot = DeviceDataSnapshot(
			apps: [],
			disk: nil,
			favoritePaths: ["Home"],
			updatableApps: ["files"]
		)
		DeviceDataStore.save(snapshot, deviceId: deviceId, accountId: accountId)

		XCTAssertTrue(fileManager.fileExists(atPath: expectedFile.path))
		XCTAssertEqual(DeviceDataStore.load(deviceId: deviceId, accountId: accountId)?.favoritePaths, ["Home"])
		XCTAssertEqual(try Data(contentsOf: sentinel), sentinelData)

		DeviceDataStore.delete(deviceId: deviceId)

		XCTAssertFalse(fileManager.fileExists(atPath: deviceDirectory.path))
		XCTAssertEqual(try Data(contentsOf: sentinel), sentinelData)
	}

	func testCredentialPasteboardIsLocalAndShortLived() throws {
		let now = Date(timeIntervalSince1970: 1_000)
		let options = CredentialPasteboard.options(now: now)

		XCTAssertEqual(options[.localOnly] as? Bool, true)
		XCTAssertEqual(
			try XCTUnwrap(options[.expirationDate] as? Date),
			now.addingTimeInterval(CredentialPasteboard.expirationInterval)
		)
		XCTAssertEqual(CredentialPasteboard.expirationInterval, 120)
	}

	@MainActor
	func testCredentialPasteboardStillCopiesTheCredential() {
		let pasteboard = UIPasteboard.general
		defer { pasteboard.items = [] }

		CredentialPasteboard.copy("temporary-test-credential")

		XCTAssertEqual(pasteboard.string, "temporary-test-credential")
	}

	private func cacheKey(_ value: String) -> String {
		SHA256.hash(data: Data(value.utf8))
			.map { String(format: "%02x", $0) }
			.joined()
	}
}
