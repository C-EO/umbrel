import Foundation
import UmbrelKit

// Keeps already-paired devices aligned with Bonjour while the app is active. TXT
// ids only select possible matches; the saved CA and HTTPS discovery response must
// still prove the device before any hostname is changed.
@MainActor
final class SavedDeviceDiscoveryMonitor {
	private let discovery = Discovery()
	private var discoverySettleTask: Task<Void, Never>?
	private var identificationTask: Task<Void, Never>?
	private var onRefresh: (() -> Void)?
	private var onStorageIssue: ((Config.StorageIssue) -> Void)?
	private var running = false

	func start(
		onRefresh: @escaping () -> Void,
		onStorageIssue: @escaping (Config.StorageIssue) -> Void
	) {
		self.onRefresh = onRefresh
		self.onStorageIssue = onStorageIssue
		guard !running else { return }
		running = true
		discovery.onUpdate = { [weak self] candidates in
			self?.scheduleIdentification(for: candidates)
		}
		discovery.start()
	}

	func stop() {
		guard running else { return }
		running = false
		discoverySettleTask?.cancel()
		discoverySettleTask = nil
		identificationTask?.cancel()
		identificationTask = nil
		discovery.onUpdate = nil
		onRefresh = nil
		onStorageIssue = nil
		discovery.stop()
	}

	private func scheduleIdentification(for candidates: [Candidate]) {
		discoverySettleTask?.cancel()
		discoverySettleTask = Task { [weak self] in
			// Bonjour publishes once with the hostname and again when addresses resolve.
			// Let that short burst settle so saved devices are verified only once.
			do {
				try await Task.sleep(for: .milliseconds(250))
			} catch {
				return
			}
			guard let self, running else { return }
			identifySavedDevices(in: candidates)
		}
	}

	private func identifySavedDevices(in candidates: [Candidate]) {
		identificationTask?.cancel()
		let loaded = Config.load()
		if let issue = loaded.issue {
			onStorageIssue?(issue)
			return
		}
		let savedIds = Set(loaded.config.savedDevices.keys)
		let possibleMatches = candidates.compactMap { candidate -> (Candidate, String)? in
			guard let id = candidate.id, savedIds.contains(id) else { return nil }
			return (candidate, id)
		}
		guard !possibleMatches.isEmpty else { return }

		identificationTask = Task { [weak self] in
			let identified = await withTaskGroup(of: IdentifiedDevice?.self) { group in
				for (candidate, deviceId) in possibleMatches {
					group.addTask {
						await Umbreld.identify(candidate: candidate, expectedDeviceId: deviceId)
					}
				}
				var devices = [IdentifiedDevice]()
				for await device in group {
					if let device { devices.append(device) }
				}
				return devices
			}
			guard !Task.isCancelled, let self else { return }

			var byId = [String: IdentifiedDevice]()
			for device in identified.sorted(by: { left, right in
				let leftIsBonjour = SavedDevice.isBonjourHostname(left.host)
				let rightIsBonjour = SavedDevice.isBonjourHostname(right.host)
				if leftIsBonjour != rightIsBonjour { return leftIsBonjour }
				return left.host.lowercased() < right.host.lowercased()
			}) where byId[device.id] == nil {
				byId[device.id] = device
			}

			let loaded = Config.load()
			if let issue = loaded.issue {
				onStorageIssue?(issue)
				return
			}
			var config = loaded.config
			var changed = false
			for discovered in byId.values {
				guard let saved = config.savedDevices[discovered.id] else { continue }
				var refreshed = saved
				refreshed.mergeVerifiedDiscovery(discovered)
				if refreshed != saved {
					do {
						try config.save(refreshed)
						changed = true
					} catch {
						onStorageIssue?((error as? Config.StorageIssue) ?? .saveFailed)
						return
					}
				}
			}
			if changed { onRefresh?() }
		}
	}
}
