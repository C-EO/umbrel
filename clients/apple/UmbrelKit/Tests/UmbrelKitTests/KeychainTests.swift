import Foundation
import Security
import XCTest
@testable import UmbrelKit

final class KeychainTests: XCTestCase {
	func testMissingItemIsDefinitive() {
		guard case .missing = Keychain.classifySessionRead(status: errSecItemNotFound, data: nil) else {
			return XCTFail("Expected a missing session")
		}
	}

	func testTransientKeychainFailureIsNotMissing() {
		let transientStatus = OSStatus(-34_018)
		guard case .unavailable(let status, let cachedSession) = Keychain.classifySessionRead(
			status: transientStatus, data: nil)
		else {
			return XCTFail("Expected an unavailable Keychain")
		}
		XCTAssertEqual(status, transientStatus)
		XCTAssertNil(cachedSession)
	}

	func testTransientFailureCanRetainTheLastKnownSession() {
		let session = makeSession()
		let result = Keychain.SessionReadResult.unavailable(status: -34_018, cachedSession: session)

		XCTAssertEqual(result.session, session)
	}

	func testMalformedStoredSessionIsInvalid() {
		guard case .invalid = Keychain.classifySessionRead(status: errSecSuccess, data: Data("not-json".utf8)) else {
			return XCTFail("Expected an invalid stored session")
		}
	}

	func testValidStoredSessionIsReturned() throws {
		let session = makeSession()
		let data = try JSONEncoder().encode(session)

		guard case .found(let decoded) = Keychain.classifySessionRead(status: errSecSuccess, data: data) else {
			return XCTFail("Expected a stored session")
		}
		XCTAssertEqual(decoded, session)
	}

	func testStoredSessionWithoutAccountIdIsInvalid() throws {
		let data = try XCTUnwrap(
			"""
			{"deviceId":"device","accessToken":"access","accessExpiresAt":1,"deviceToken":"device-token"}
			""".data(using: .utf8)
		)

		guard case .invalid = Keychain.classifySessionRead(status: errSecSuccess, data: data) else {
			return XCTFail("Expected a session without an account id to be invalid")
		}
	}

	private func makeSession() -> Umbreld.Session {
		Umbreld.Session(
			deviceId: "device",
			accountId: "0",
			accessToken: "access",
			accessExpiresAt: 1,
			deviceToken: "device-token")
	}
}
