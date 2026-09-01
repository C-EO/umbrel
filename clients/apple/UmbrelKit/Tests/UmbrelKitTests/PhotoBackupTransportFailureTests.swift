import Foundation
@testable import UmbrelKit
import XCTest

final class PhotoBackupTransportFailureTests: XCTestCase {
	func testTemporaryConnectivityErrorsRecoverAutomatically() {
		let codes: [URLError.Code] = [
			.timedOut,
			.cannotFindHost,
			.cannotConnectToHost,
			.networkConnectionLost,
			.dnsLookupFailed,
			.notConnectedToInternet,
			.dataNotAllowed,
		]
		for code in codes {
			XCTAssertTrue(PhotoBackupTransportFailure.isConnectivityFailure(URLError(code)))
		}
	}

	func testSecurityAndServerErrorsDoNotHideAsConnectivity() {
		let codes: [URLError.Code] = [
			.cancelled,
			.badServerResponse,
			.userAuthenticationRequired,
			.appTransportSecurityRequiresSecureConnection,
			.secureConnectionFailed,
			.serverCertificateUntrusted,
		]
		for code in codes {
			XCTAssertFalse(PhotoBackupTransportFailure.isConnectivityFailure(URLError(code)))
		}
		XCTAssertFalse(PhotoBackupTransportFailure.isConnectivityFailure(
			NSError(domain: "PHPhotosErrorDomain", code: -1)
		))
	}
}
