import SwiftUI
import UmbrelKit

// App root and navigation:
//  - no saved devices  → first-run onboarding
//  - a signed-in device selected → that device's tabs
//  - otherwise         → the all-devices list
// Saved devices and their Keychain sessions are deliberately separate: signing out returns to
// the list and keeps the Umbrel available for an immediate sign-in, while removing an Umbrel is
// a distinct action. The selected device id is remembered so relaunching returns to it.
struct RootView: View {
	@Environment(\.scenePhase) private var scenePhase
	@AppStorage("selectedDeviceId") private var selectedDeviceId = ""
	@State private var addingDevice = false
	@State private var signInDevice: SavedDevice?
	@State private var connectionSnapshots: [String: DeviceConnectionSnapshot] = [:]
	@State private var savedDeviceDiscovery = SavedDeviceDiscoveryMonitor()
	@State private var configStorageIssue: Config.StorageIssue?
	// Held in state and refreshed at the points where a session can appear (onboarding
	// finishes) or disappear (sign out). Reading from disk inside body instead would leave
	// navigation dependent on selectedDeviceId *changing* — finishing onboarding while the
	// persisted selection already points at the device would then do nothing.
	@State private var devices: [SavedDevice]

	init() {
		let result = Config.load()
		_devices = State(initialValue: Self.sortedDevices(in: result.config))
		_configStorageIssue = State(initialValue: result.issue)
	}

	var body: some View {
		Group {
			if devices.isEmpty || addingDevice {
				OnboardingFlow(
					mode: devices.isEmpty ? .firstRun : .addDevice,
					onCancel: { addingDevice = false }
				) { deviceId in
					connectionSnapshots[deviceId] = DeviceConnectionSnapshot(
						state: .connected,
						checkedAt: Date()
					)
					selectedDeviceId = deviceId
					addingDevice = false
					reloadSavedDevices()
				}
			} else if let device = devices.first(where: { $0.id == selectedDeviceId }),
				hasSession(device.id)
			{
				MainView(
					device: device,
					connectionSnapshot: connectionSnapshot(for: device.id)
				) {
					// Back or sign out: re-read session state before routing.
					selectedDeviceId = ""
					reloadSavedDevices()
				}
			} else {
				AllDevicesView(
					devices: devices,
					connectionSnapshots: $connectionSnapshots,
					onConfigStorageIssue: { configStorageIssue = $0 },
					onSelect: { device in
						if hasSession(device.id) {
							selectedDeviceId = device.id
						} else {
							signInDevice = device
						}
					},
					onAdd: { addingDevice = true }
				)
			}
		}
		.sheet(
			isPresented: Binding(
				get: { signInDevice != nil },
				set: { if !$0 { signInDevice = nil } }
			)
		) {
			if let device = signInDevice {
				UmbrelSignInForm(
					title: device.model ?? device.name,
					target: device.nativeTarget,
					browserHost: device.host,
					preferredUserId: device.lastAccountId,
					onPrepare: {
						try await Umbreld.prepareSavedDeviceForSignIn(device.nativeTarget)
					},
					onCancel: { signInDevice = nil },
					onRemove: {
						do {
							try await MainModel.removeSavedDevice(device)
						} catch {
							configStorageIssue = (error as? Config.StorageIssue) ?? .saveFailed
							return
						}
						connectionSnapshots[device.id] = nil
						signInDevice = nil
						selectedDeviceId = ""
						reloadSavedDevices()
					}
				) { account, userId, password, totpToken in
					let session = try await Umbreld.login(
						target: device.nativeTarget,
						userId: userId,
						password: password,
						totpToken: totpToken
					)
					try Task.checkCancellation()
					guard Keychain.setSession(session, deviceId: device.id) else {
						throw SignInError.sessionStorageFailed
					}
					// Reconnecting an account must not move the iPhone library away from
					// another Umbrel. Backup ownership changes only through backup controls.
					let result = Config.load()
					if let issue = result.issue {
						Keychain.deleteSession(deviceId: device.id)
						try? await Umbreld.logout(target: device.nativeTarget, session: session)
						throw issue
					}
					var config = result.config
					guard config.savedDevices[device.id] != nil else {
						Keychain.deleteSession(deviceId: device.id)
						try? await Umbreld.logout(target: device.nativeTarget, session: session)
						throw Config.StorageIssue.saveFailed
					}
					do {
						try config.update(id: device.id) {
							if let account, account.userId == session.accountId {
								$0.saveAccountProfile(
									accountId: account.userId,
									name: account.name,
									wallpaperId: account.wallpaper.id,
									wallpaperBrandColorHsl: account.wallpaper.brandColorHsl,
									role: account.userId == "0" ? "owner" : "member"
								)
							} else if let profile = $0.accountProfile(for: session.accountId) {
								$0.saveAccountProfile(
									accountId: session.accountId,
									name: profile.name,
									wallpaperId: profile.wallpaperId,
									wallpaperBrandColorHsl: profile.wallpaperBrandColorHsl,
									role: profile.role
								)
							} else {
								$0.lastAccountId = session.accountId
							}
						}
					} catch {
						Keychain.deleteSession(deviceId: device.id)
						try? await Umbreld.logout(target: device.nativeTarget, session: session)
						throw error
					}
					connectionSnapshots[device.id] = DeviceConnectionSnapshot(
						state: .connected,
						checkedAt: Date()
					)
					reloadSavedDevices()
					selectedDeviceId = device.id
					signInDevice = nil
				}
			}
		}
		.onAppear { updateSavedDeviceDiscovery() }
		.onDisappear { savedDeviceDiscovery.stop() }
		.onChange(of: shouldDiscoverSavedDevices) { _, _ in
			updateSavedDeviceDiscovery()
		}
		.alert(item: $configStorageIssue) { issue in
			Alert(
				title: Text(issue.title),
				message: Text(issue.localizedDescription),
				dismissButton: .default(Text("OK"))
			)
		}
	}

	private var shouldDiscoverSavedDevices: Bool {
		scenePhase == .active && !devices.isEmpty && !addingDevice
	}

	private func updateSavedDeviceDiscovery() {
		guard shouldDiscoverSavedDevices else {
			savedDeviceDiscovery.stop()
			return
		}
		savedDeviceDiscovery.start(
			onRefresh: {
				let result = Config.load()
				if let issue = result.issue {
					configStorageIssue = issue
					return
				}
				let refreshed = Self.sortedDevices(in: result.config)
				if devices != refreshed { devices = refreshed }
				if let signingIn = signInDevice {
					signInDevice = refreshed.first(where: { $0.id == signingIn.id })
				}
			},
			onStorageIssue: { configStorageIssue = $0 }
		)
	}

	private func connectionSnapshot(for deviceId: String) -> Binding<DeviceConnectionSnapshot> {
		Binding(
			get: { connectionSnapshots[deviceId] ?? .unverified },
			set: { connectionSnapshots[deviceId] = $0 }
		)
	}

	private func reloadSavedDevices() {
		let result = Config.load()
		if let issue = result.issue {
			configStorageIssue = issue
			return
		}
		devices = Self.sortedDevices(in: result.config)
	}

	private static func sortedDevices(in config: Config) -> [SavedDevice] {
		config.savedDevices.values.sorted { $0.id < $1.id }
	}
}

// A transient Keychain failure must not masquerade as sign-out. Keychain preserves any
// in-memory credential in that case, and MainModel retries the read when the app foregrounds.
private func hasSession(_ deviceId: String) -> Bool {
	switch Keychain.readSession(deviceId: deviceId) {
	case .found, .unavailable: true
	case .missing, .invalid: false
	}
}
