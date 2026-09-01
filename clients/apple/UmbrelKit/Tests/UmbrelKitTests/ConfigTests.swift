import XCTest
@testable import UmbrelKit

final class ConfigTests: XCTestCase {
	func testMissingConfigIsAnEmptyWritableConfig() throws {
		let fileURL = try temporaryConfigURL()
		let result = Config.load(from: fileURL)

		XCTAssertNil(result.issue)
		XCTAssertTrue(result.config.savedDevices.isEmpty)
		var config = result.config
		try config.save(device())
		XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path))
	}

	func testCorruptConfigIsQuarantinedBeforeRecovery() throws {
		let fileURL = try temporaryConfigURL()
		try Data("not-json".utf8).write(to: fileURL)

		let result = Config.load(from: fileURL)

		XCTAssertEqual(result.issue, .corruptQuarantined)
		XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path))
		let siblings = try FileManager.default.contentsOfDirectory(
			at: fileURL.deletingLastPathComponent(),
			includingPropertiesForKeys: nil
		)
		XCTAssertEqual(siblings.filter { $0.lastPathComponent.hasPrefix("config.corrupt-") }.count, 1)

		var recovered = result.config
		try recovered.save(device())
		XCTAssertEqual(Config.load(from: fileURL).config.savedDevices["device"], device())
	}

	func testFailedSaveDoesNotChangeInMemoryConfig() throws {
		let directory = FileManager.default.temporaryDirectory
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
		let blockedParent = directory.appendingPathComponent("blocked")
		try Data().write(to: blockedParent)
		let fileURL = blockedParent.appendingPathComponent("config.json")
		var config = Config.load(from: fileURL).config

		XCTAssertThrowsError(try config.save(device()))
		XCTAssertTrue(config.savedDevices.isEmpty)
	}

	func testUnreadableConfigIsNotTreatedAsWritableEmptyState() throws {
		let fileURL = try temporaryConfigURL()
		try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)

		let result = Config.load(from: fileURL)

		XCTAssertEqual(result.issue, .unreadable)
		var config = result.config
		XCTAssertThrowsError(try config.save(device()))
	}

	private func temporaryConfigURL() throws -> URL {
		let directory = FileManager.default.temporaryDirectory
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
		return directory.appendingPathComponent("config.json")
	}

	private func device() -> SavedDevice {
		SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["192.168.1.10"]
		)
	}
}
