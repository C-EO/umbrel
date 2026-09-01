import XCTest
@testable import UmbrelKit

final class SavedDeviceAccountTests: XCTestCase {
	func testTopLevelPresentationDoesNotDefineAnAccountProfile() {
		let device = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["umbrel.local"],
			userName: "Mayank",
			wallpaperId: "22"
		)

		XCTAssertEqual(device.userName, "Mayank")
		XCTAssertEqual(device.wallpaperId, "22")
		XCTAssertNil(device.accountProfile(for: "0"))
		XCTAssertNil(device.accountProfile(for: "member"))
	}

	func testProfilesAreStoredSeparatelyByAccount() {
		var device = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["umbrel.local"]
		)

		device.saveAccountProfile(
			accountId: "0",
			name: "Mayank",
			wallpaperId: "22",
			wallpaperBrandColorHsl: "92 52% 41%",
			role: "owner"
		)
		device.saveAccountProfile(
			accountId: "nate",
			name: "Nate",
			wallpaperId: "4",
			wallpaperBrandColorHsl: "198 100% 31%",
			role: "member"
		)

		XCTAssertEqual(
			device.accountProfile(for: "0"),
			SavedAccountProfile(
				name: "Mayank",
				wallpaperId: "22",
				wallpaperBrandColorHsl: "92 52% 41%",
				role: "owner"
			)
		)
		XCTAssertEqual(
			device.accountProfile(for: "nate"),
			SavedAccountProfile(
				name: "Nate",
				wallpaperId: "4",
				wallpaperBrandColorHsl: "198 100% 31%",
				role: "member"
			)
		)
		XCTAssertEqual(device.userName, "Nate")
		XCTAssertEqual(device.wallpaperId, "4")
		XCTAssertEqual(device.lastAccountId, "nate")
	}

	func testHTTPSWarningPreferenceRoundTrips() throws {
		let device = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["umbrel.local"],
			suppressHTTPSRequiredAppWarning: true
		)

		let decoded = try JSONDecoder().decode(SavedDevice.self, from: JSONEncoder().encode(device))

		XCTAssertTrue(decoded.suppressHTTPSRequiredAppWarning == true)
	}
}
