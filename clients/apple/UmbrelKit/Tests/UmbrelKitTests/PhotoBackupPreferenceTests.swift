import XCTest
@testable import UmbrelKit

@MainActor
final class PhotoBackupPreferenceTests: XCTestCase {
	private var defaults: UserDefaults!

	override func setUp() {
		super.setUp()
		defaults = UserDefaults(suiteName: "PhotoBackupPreferenceTests")
		defaults.removePersistentDomain(forName: "PhotoBackupPreferenceTests")
	}

	func testPreferencesAreIsolatedByDeviceAndAccount() {
		let owner = PhotoBackupPreference(includesPhotos: true, allowsCellular: true)
		let member = PhotoBackupPreference(includesVideos: true)
		PhotoBackupPreferenceStore.save(owner, deviceId: "umbrel", accountId: "0", activate: true, defaults: defaults)
		PhotoBackupPreferenceStore.save(member, deviceId: "umbrel", accountId: "nate", activate: true, defaults: defaults)

		XCTAssertEqual(PhotoBackupPreferenceStore.preference(deviceId: "umbrel", accountId: "0", defaults: defaults), owner)
		XCTAssertEqual(PhotoBackupPreferenceStore.preference(deviceId: "umbrel", accountId: "nate", defaults: defaults), member)
		XCTAssertFalse(PhotoBackupPreferenceStore.isActive(deviceId: "umbrel", accountId: "0", defaults: defaults))
		XCTAssertTrue(PhotoBackupPreferenceStore.isActive(deviceId: "umbrel", accountId: "nate", defaults: defaults))
		XCTAssertEqual(
			PhotoBackupPreferenceStore.activeTarget(defaults: defaults),
			PhotoBackupPreferenceTarget(deviceId: "umbrel", accountId: "nate")
		)
	}

	func testSavingAnInactivePreferenceDoesNotReplaceTheActiveTarget() {
		PhotoBackupPreferenceStore.save(
			PhotoBackupPreference(includesPhotos: true),
			deviceId: "umbrel",
			accountId: "0",
			activate: true,
			defaults: defaults
		)
		PhotoBackupPreferenceStore.save(
			PhotoBackupPreference(includesVideos: true),
			deviceId: "umbrel",
			accountId: "nate",
			activate: false,
			defaults: defaults
		)

		XCTAssertTrue(PhotoBackupPreferenceStore.isActive(deviceId: "umbrel", accountId: "0", defaults: defaults))
		XCTAssertFalse(PhotoBackupPreferenceStore.isActive(deviceId: "umbrel", accountId: "nate", defaults: defaults))
	}

	func testRemovingDeviceClearsItsPreferencesAndActiveTarget() {
		PhotoBackupPreferenceStore.save(
			PhotoBackupPreference(includesPhotos: true),
			deviceId: "umbrel",
			accountId: "nate",
			activate: true,
			defaults: defaults
		)

		PhotoBackupPreferenceStore.removeDevice("umbrel", defaults: defaults)

		XCTAssertEqual(
			PhotoBackupPreferenceStore.preference(deviceId: "umbrel", accountId: "nate", defaults: defaults),
			PhotoBackupPreference()
		)
		XCTAssertFalse(PhotoBackupPreferenceStore.isActive(deviceId: "umbrel", accountId: "nate", defaults: defaults))
	}

	func testLiveConfigurationRepairsOnlyTheActiveTarget() {
		let preference = PhotoBackupPreference(includesVideos: true, allowsCellular: true)
		PhotoBackupPreferenceStore.save(
			preference,
			deviceId: "umbrel",
			accountId: "nate",
			activate: false,
			defaults: defaults
		)

		PhotoBackupPreferenceStore.reconcileActiveTarget(
			deviceId: "umbrel",
			accountId: "nate",
			defaults: defaults
		)

		XCTAssertTrue(PhotoBackupPreferenceStore.isActive(deviceId: "umbrel", accountId: "nate", defaults: defaults))
		XCTAssertEqual(
			PhotoBackupPreferenceStore.preference(deviceId: "umbrel", accountId: "nate", defaults: defaults),
			preference
		)
	}

	func testDisabledPreferenceCannotBeReactivatedByStaleConfiguration() {
		PhotoBackupPreferenceStore.save(
			PhotoBackupPreference(),
			deviceId: "umbrel",
			accountId: "nate",
			activate: false,
			defaults: defaults
		)

		PhotoBackupPreferenceStore.reconcileActiveTarget(
			deviceId: "umbrel",
			accountId: "nate",
			defaults: defaults
		)

		XCTAssertFalse(PhotoBackupPreferenceStore.isActive(
			deviceId: "umbrel",
			accountId: "nate",
			defaults: defaults
		))
	}
}
