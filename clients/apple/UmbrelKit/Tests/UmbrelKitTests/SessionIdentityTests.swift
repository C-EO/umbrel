import XCTest
@testable import UmbrelKit

final class SessionIdentityTests: XCTestCase {
	func testRotatedAccessTokenStillBelongsToSameLogin() {
		let original = makeSession(accountId: "0", accessToken: "access-1", deviceToken: "device-token")
		let rotated = makeSession(accountId: "0", accessToken: "access-2", deviceToken: "device-token")

		XCTAssertTrue(original.belongsToSameLogin(as: rotated))
	}

	func testDifferentAccountNeverBelongsToSameLogin() {
		let owner = makeSession(accountId: "0", accessToken: "owner-access", deviceToken: "owner-device")
		let member = makeSession(accountId: "nate", accessToken: "member-access", deviceToken: "member-device")

		XCTAssertFalse(owner.belongsToSameLogin(as: member))
	}

	func testNewLoginForSameAccountHasDifferentIdentity() {
		let old = makeSession(accountId: "0", accessToken: "access-1", deviceToken: "device-token-1")
		let new = makeSession(accountId: "0", accessToken: "access-2", deviceToken: "device-token-2")

		XCTAssertFalse(old.belongsToSameLogin(as: new))
	}

	private func makeSession(accountId: String, accessToken: String, deviceToken: String) -> Umbreld.Session {
		Umbreld.Session(
			deviceId: "umbrel",
			accountId: accountId,
			accessToken: accessToken,
			accessExpiresAt: 1,
			deviceToken: deviceToken
		)
	}
}
