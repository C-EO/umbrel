import AppKit
import Sparkle
import SwiftUI

@main
struct UmbrelApp: App {
	@NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

	var body: some Scene {
		// All UI lives in the status item's panel (see StatusItemController);
		// an empty Settings scene satisfies SwiftUI's need for at least one scene.
		Settings {}
	}
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
	private var statusItemController: StatusItemController?
	private let updateController = UpdateController()

	func applicationDidFinishLaunching(_ notification: Notification) {
		let launchedAtLogin = Self.launchedAtLogin
		// Menu bar only, no Dock icon. The bundled app also sets LSUIElement;
		// this covers bare `swift run` during development.
		NSApp.setActivationPolicy(.accessory)
		updateController.start()
		let state = AppState()
		state.registerLaunchAtLoginByDefaultIfNeeded()
		let statusItemController = StatusItemController(
			state: state,
			updateController: updateController
		)
		self.statusItemController = statusItemController
		if !launchedAtLogin {
			statusItemController.presentPanelWhenReady()
		}
	}

	func applicationShouldHandleReopen(
		_ sender: NSApplication,
		hasVisibleWindows: Bool
	) -> Bool {
		statusItemController?.presentPanelWhenReady()
		return false
	}

	// macOS marks the open-application Apple Event when the system starts an app
	// as a login item. Read it during did-finish-launching, while it is current.
	private static var launchedAtLogin: Bool {
		guard let event = NSAppleEventManager.shared().currentAppleEvent else {
			return false
		}
		return event.eventID == kAEOpenApplication
			&& event.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue
				== keyAELaunchedAsLogInItem
	}
}
