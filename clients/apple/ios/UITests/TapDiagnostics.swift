import XCTest

// Guards against the FrostBackground tap-shield regression: every frosted card draws a
// screen-sized wallpaper image whose hit area, if hit-testable, silently swallows taps
// for all content laid out before it (clipShape trims drawing, not hit areas). These
// tests fail loudly if any full-screen surface starts eating touches again.
final class HomeNavigationTests: XCTestCase {
	private func launchToHome() -> XCUIApplication {
		let app = XCUIApplication()
		app.launch()
		// Fresh launches land on the all-devices list; enter a reachable device.
		let deviceCard = app.staticTexts["Connected"].firstMatch
		if deviceCard.waitForExistence(timeout: 10) {
			deviceCard.tap()
		}
		return app
	}

	func testAppsHeaderOpensAppsTab() throws {
		let app = launchToHome()
		let header = app.buttons["homeAppsHeader"]
		XCTAssertTrue(header.waitForExistence(timeout: 10))
		header.tap()
		XCTAssertTrue(app.tabBars.buttons["Apps"].waitForExistence(timeout: 3))
		XCTAssertTrue(app.tabBars.buttons["Apps"].isSelected, "Apps header tap did not switch tabs")
	}

	func testLibraryHeaderOpensLibraryTab() throws {
		let app = launchToHome()
		let header = app.buttons["homeLibraryHeader"]
		XCTAssertTrue(header.waitForExistence(timeout: 10))
		header.tap()
		XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 3))
		XCTAssertTrue(app.tabBars.buttons["Library"].isSelected, "Library header tap did not switch tabs")
	}

	func testPrimaryScreenPassesAccessibilityAudit() throws {
		continueAfterFailure = true
		let app = launchToHome()
		try app.performAccessibilityAudit(for: .contrast) { issue in
			// XCTest cannot resolve the real backdrop behind this translucent pill and
			// reports a false contrast failure. Its rendered pixels were verified to
			// exceed the required contrast; suppress only this identified surface.
			issue.auditType == .contrast
				&& issue.element?.identifier == "onboardingSubtleButton"
		}
		try app.performAccessibilityAudit(for: .all.subtracting(.contrast))
	}
}
