import Testing
@testable import UmbrelKit

@Suite("Umbrel device kind")
struct DeviceKindTests {
	@Test("Recognizes every supported hardware family", arguments: [
		("Umbrel Home (2025)", UmbrelDeviceKind.home),
		("Umbrel Pro", UmbrelDeviceKind.pro),
		("Raspberry Pi 5", UmbrelDeviceKind.raspberryPi),
		("Raspberry Pi 4", UmbrelDeviceKind.raspberryPi),
		("Standard PC (Q35 + ICH9, 2009)", UmbrelDeviceKind.generic),
	])
	func recognizedModel(model: String, expected: UmbrelDeviceKind) {
		#expect(UmbrelDeviceKind(model: model) == expected)
	}

	@Test("Missing model uses generic hardware")
	func missingModel() {
		#expect(UmbrelDeviceKind(model: nil) == .generic)
	}
}
