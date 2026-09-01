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
		statusItemController.presentInitialPanelIfNeeded()
	}
}
