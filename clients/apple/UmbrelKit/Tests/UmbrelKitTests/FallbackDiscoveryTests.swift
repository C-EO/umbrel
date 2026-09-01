import XCTest

@testable import UmbrelKit

final class FallbackDiscoveryTests: XCTestCase {
	func testFallbackHostsStaySmallAndPredictable() {
		XCTAssertEqual(
			Umbreld.fallbackDiscoveryHosts,
			[
				"umbrel.local",
				"umbrel-2.local",
				"umbrel-3.local",
				"umbrel-4.local",
				"umbrel-5.local",
				"umbrel-home.local",
				"umbrel-pro.local",
			]
		)
	}

	func testFallbackResponseRequiresTheUmbrelOSVersionContract() throws {
		let valid = Data(#"{"result":{"data":{"version":"1.7.4","name":"umbrelOS 1.7.4"}}}"#.utf8)
		XCTAssertNoThrow(try Umbreld.validateFallbackSystemVersion(data: valid, status: 200))

		let unrelated = Data(#"{"result":{"data":{"version":"1.7.4","name":"Another service"}}}"#.utf8)
		XCTAssertThrowsError(try Umbreld.validateFallbackSystemVersion(data: unrelated, status: 200))

		let incomplete = Data(#"{"result":{"data":{"version":"1.7.4"}}}"#.utf8)
		XCTAssertThrowsError(try Umbreld.validateFallbackSystemVersion(data: incomplete, status: 200))
	}

	func testLiveFallbackDiscovery() async throws {
		try XCTSkipUnless(
			ProcessInfo.processInfo.environment["UMBRELKIT_FALLBACK_DISCOVERY_TEST"] == "1",
			"Set UMBRELKIT_FALLBACK_DISCOVERY_TEST=1 on a network with legacy and current Umbrels"
		)

		let result = await Umbreld.discoverFallbackHosts()
		XCTAssertFalse(result.isEmpty, "Expected at least one common Umbrel hostname to answer")
	}
}
