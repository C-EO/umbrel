import XCTest
@testable import UmbrelKit

final class PhotoBackupSourceTests: XCTestCase {
	func testSourceDecodesAuthenticatedAccountId() throws {
		let source = try JSONDecoder().decode(
			PhotoBackupSource.self,
			from: Data(
				"""
				{"id":"source","accountId":"alice","name":"iPhone","createdAt":1786320000000}
				""".utf8
			)
		)

		XCTAssertEqual(source.accountId, "alice")
	}

	func testSourceRequiresAccountId() {
		for json in [
			#"{"id":"source","name":"iPhone"}"#,
			#"{"id":"source","accountId":null,"name":"iPhone"}"#,
		] {
			XCTAssertThrowsError(
				try JSONDecoder().decode(PhotoBackupSource.self, from: Data(json.utf8))
			)
		}
	}
}
