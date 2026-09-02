import Foundation
import Security
import XCTest
@testable import UmbrelKit

final class KeychainTests: XCTestCase {
	func testExplicitClaimCanReplaceAStaleUnsavedCA() throws {
		let deviceId = "keychain-test-\(UUID().uuidString)"
		let staleCertificate = Data("stale-candidate".utf8)
		let selectedCertificate = Data("explicitly-selected-candidate".utf8)
		defer { Keychain.deleteLocalHTTPSCA(deviceId: deviceId) }

		let initialEnrollment = Keychain.storeLocalHTTPSCAIfAbsent(
			staleCertificate,
			deviceId: deviceId
		)
		if initialEnrollment == .unavailable(status: Int32(errSecMissingEntitlement)) {
			throw XCTSkip("The standalone SwiftPM test runner has no Data Protection Keychain entitlement")
		}
		XCTAssertEqual(
			initialEnrollment,
			.stored
		)
		// Ordinary enrollment remains write-once; only the explicit unsaved-device
		// claim path below is permitted to recover this stale identity.
		XCTAssertEqual(
			Keychain.storeLocalHTTPSCAIfAbsent(selectedCertificate, deviceId: deviceId),
			.conflicts
		)
		XCTAssertEqual(
			Keychain.replaceLocalHTTPSCA(selectedCertificate, deviceId: deviceId),
			.stored
		)
		XCTAssertEqual(
			Keychain.readLocalHTTPSCA(deviceId: deviceId),
			.found(selectedCertificate)
		)
	}

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
