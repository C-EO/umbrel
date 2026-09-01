import Security
import XCTest
@testable import UmbrelKit

final class LocalHTTPSTests: XCTestCase {
	func testLiveEnrollmentUsesCandidateThenStoredCA() async throws {
		guard let host = ProcessInfo.processInfo.environment["UMBRELKIT_HTTPS_TEST_HOST"] else {
			throw XCTSkip("Set UMBRELKIT_HTTPS_TEST_HOST to run against an Umbrel")
		}

		guard let first = await Umbreld.identify(host: host) else {
			return XCTFail("First-use HTTPS enrollment failed")
		}
		let second = await Umbreld.identify(host: host, expectedDeviceId: first.id)
		await Umbreld.forgetLocalHTTPSIdentity(deviceId: first.id)

		XCTAssertEqual(second?.id, first.id)
	}

	func testPEMCertificateIsParsedAndCanonicalized() throws {
		let data = try LocalHTTPSTransport.certificateData(fromPEM: testCertificatePEM)
		let certificate = try XCTUnwrap(SecCertificateCreateWithData(nil, data as CFData))

		XCTAssertEqual(data, SecCertificateCopyData(certificate) as Data)
	}

	func testMalformedPEMCertificateIsRejected() {
		XCTAssertThrowsError(
			try LocalHTTPSTransport.certificateData(
				fromPEM: "-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----")) { error in
				XCTAssertEqual(error as? LocalHTTPSTransportError, .invalidCertificate)
			}
	}

	private let testCertificatePEM = """
		-----BEGIN CERTIFICATE-----
		MIIDLDCCAhSgAwIBAgIUQN+vZuip6m95yaEcLuqGiALn47IwDQYJKoZIhvcNAQEL
		BQAwHDEaMBgGA1UEAwwRVW1icmVsS2l0LVRlc3QtQ0EwHhcNMjYwODEzMDMyNzQ0
		WhcNMzYwODEwMDMyNzQ0WjAcMRowGAYDVQQDDBFVbWJyZWxLaXQtVGVzdC1DQTCC
		ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALHtaPqHCHtQCD7XGFkHTFAk
		XlU9mZra/7zocYZUK2l7QwxuxIkbar2YlYHVhm4CM47kLVmi+OGFPOpndeymfX1o
		gYCn60ycylKoVcx6gobNJzBETuWSDI2D1QIrWvItnEUYuJK7sl9LEmXa4RHq3H/R
		KclbxMtuZf71R1JqzsRKeD0zShNipSJ5etpDKWdW2KxTQFHtRqfjG+gmAaxhr42E
		YvB1TZ08S2xepq/iNc8vEpfMgzwyxyDXV61WRBkNYCWzcTJZ4TpxFF6+z1FbUSdA
		iYymrr99WExgqk+y9XLI3sk6gvTW+/U13RzeozCH6voZVPBguiDzmzPrhPYQXpUC
		AwEAAaNmMGQwHQYDVR0OBBYEFBLj2Fz36XxyX1U5VgDp6BjiThN2MB8GA1UdIwQY
		MBaAFBLj2Fz36XxyX1U5VgDp6BjiThN2MBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYD
		VR0PAQH/BAQDAgEGMA0GCSqGSIb3DQEBCwUAA4IBAQA0oHmWc659wIAVzmfYpl+q
		h9JZe0uJd+eGG1X9PSClqX8okS5IXhI2lqyn6Wy9TkKHBrUsul76g0GJAqeP4YqJ
		Bn0/xwjL0ZwybzfiKUX/IWjfksMufc3wtDkiZ7AqW9HuzhQCLa3CQRTBZ/bFzSkp
		k4x4zY3+XHzJkkcHAWkRD2qIdNXGbguHiBVBk1ZV+T/0W89efW+tQJ8dPooJX+Ng
		cypSJJWGClLjW7zSTYK8Nl1iMEsY9O8OpAg5e+WwImL7JgXssTOPj3I5rdLoKP7K
		wuGHe9yRHVZ5PZI5rUQWTY6ST5aN8rbMsOegQFJj18lPdvQAd9kfm2NI9wYKAHSC
		-----END CERTIFICATE-----
		"""
}
