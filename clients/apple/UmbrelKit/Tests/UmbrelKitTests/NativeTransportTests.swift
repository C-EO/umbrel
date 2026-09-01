import XCTest
@testable import UmbrelKit

final class NativeTransportTests: XCTestCase {
	func testLocalEndpointsUsePinnedHTTPS() {
		XCTAssertEqual(Umbreld.nativeScheme(for: "umbrel.local"), "https")
		XCTAssertEqual(Umbreld.nativeScheme(for: "192.168.1.20"), "https")
	}

	func testTailscaleEndpointsUseHTTPInsideTunnel() {
		XCTAssertEqual(Umbreld.nativeScheme(for: "100.64.0.1"), "http")
		XCTAssertEqual(Umbreld.nativeScheme(for: "100.127.255.254"), "http")
	}

	func testPublicAddressesAreNeverClassifiedAsTailscale() {
		XCTAssertEqual(Umbreld.nativeScheme(for: "100.63.255.255"), "https")
		XCTAssertEqual(Umbreld.nativeScheme(for: "100.128.0.1"), "https")
	}

	func testLiteralIPv4DetectionIsStrict() {
		XCTAssertTrue(SavedDevice.isIPv4Address("192.168.1.20"))
		XCTAssertTrue(SavedDevice.isIPv4Address("100.90.0.1"))
		XCTAssertFalse(SavedDevice.isIPv4Address("umbrel.local"))
		XCTAssertFalse(SavedDevice.isIPv4Address("192.168.1"))
		XCTAssertFalse(SavedDevice.isIPv4Address("192.168.1.999"))
		XCTAssertFalse(SavedDevice.isIPv4Address("192.168.01.20"))
		XCTAssertFalse(SavedDevice.isIPv4Address("192.168.01.20.invalid"))
	}

	func testAccountAvatarPathAcceptsOnlyUmbreldContentAddressedRoute() {
		let hash = String(repeating: "a", count: 64)
		XCTAssertTrue(Umbreld.isValidAccountAvatarPath("/api/accounts/alice-2/avatar/\(hash).webp"))

		XCTAssertFalse(Umbreld.isValidAccountAvatarPath("https://example.com/avatar.webp"))
		XCTAssertFalse(Umbreld.isValidAccountAvatarPath("//example.com/avatar.webp"))
		XCTAssertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/../avatar/\(hash).webp"))
		XCTAssertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/alice/avatar/\(hash).webp?other=1"))
		XCTAssertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/alice/avatar/\(hash.uppercased()).webp"))
	}
}
