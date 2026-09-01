import SwiftUI

// Popup content: list of devices, or the detail view for the selected one
struct PopupView: View {
	@Environment(AppState.self) private var state
	@State private var selectedId: String?
	@State private var autoSelected = false

	// Everything worth showing: saved devices (even offline) and discovered ones
	private var visibleDevices: [Device] {
		state.devices.filter { $0.saved || $0.online }
	}

	private var savedIds: [String] {
		visibleDevices.filter(\.saved).map(\.id)
	}

	var body: some View {
		Group {
			if let selectedId, visibleDevices.contains(where: { $0.id == selectedId }) {
				DeviceDetailView(deviceId: selectedId) {
					self.selectedId = nil
				}
			} else {
				DeviceListView(
					devices: visibleDevices,
					updateRequiredDevices: state.updateRequiredDevices
				) { deviceId in
					selectedId = deviceId
				}
			}
		}
		.frame(width: 420)
		// With exactly one saved device, skip the list and open its detail view.
		// Only once per app run, so navigating back to the list sticks.
		.onChange(of: savedIds, initial: true) {
			guard !autoSelected, selectedId == nil, savedIds.count == 1 else { return }
			autoSelected = true
			selectedId = savedIds[0]
		}
		.alert(
			item: Binding(
				get: { state.configStorageIssue },
				set: { if $0 == nil { state.dismissConfigStorageIssue() } }
			)
		) { issue in
			Alert(
				title: Text(issue.title),
				message: Text(issue.localizedDescription),
				dismissButton: .default(Text("OK"))
			)
		}
	}
}
