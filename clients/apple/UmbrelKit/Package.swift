// swift-tools-version: 5.9
import PackageDescription

// Shared foundation for the Apple client apps: device discovery, the umbreld API
// client, auth, and saved-device persistence.
let package = Package(
	name: "UmbrelKit",
	platforms: [.macOS(.v14), .iOS(.v17)],
	products: [
		.library(name: "UmbrelKit", targets: ["UmbrelKit"])
	],
	targets: [
		.target(name: "UmbrelKit"),
		.testTarget(name: "UmbrelKitTests", dependencies: ["UmbrelKit"])
	]
)
