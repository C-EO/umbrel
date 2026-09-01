import Foundation

extension Umbreld {
	public struct Target: Sendable, Equatable {
		public let deviceId: String
		public let hosts: [String]

		public init(deviceId: String, hosts: [String]) {
			self.deviceId = deviceId
			var seen = Set<String>()
			self.hosts = hosts.filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
		}
	}
}

enum EndpointResolutionError: LocalizedError {
	case unavailable

	var errorDescription: String? { "Couldn\u{2019}t reach this Umbrel" }
}

enum EndpointRejection: Error, Sendable, Equatable {
	case trust(String)
	case storage(String)
	case protocolFailure(String)

	var priority: Int {
		switch self {
		case .storage: 3
		case .trust: 2
		case .protocolFailure: 1
		}
	}
}

enum EndpointVerification: Sendable, Equatable {
	case verified
	case unavailable
	case rejected(EndpointRejection)
}

private enum EndpointAttempt: Sendable {
	case verified(String)
	case unavailable
	case rejected(EndpointRejection)
}

actor NativeEndpointResolver {
	typealias Verify = @Sendable (String, String) async -> EndpointVerification
	private enum PreferenceWindowExpired: Error {
		case expired
	}

	private struct ResolutionKey: Hashable {
		let deviceId: String
		let hosts: [String]
	}

	// Tailscale gives native traffic one stable endpoint as the client moves between
	// physical networks. Keep the window bounded so a disconnected tunnel adds at most
	// a brief delay before a verified local route takes over.
	private let tailscalePreferenceWindow: Duration
	private var winners: [String: String] = [:]
	private var resolutionTasks: [ResolutionKey: Task<String, Error>] = [:]

	init(tailscalePreferenceWindow: Duration = .seconds(1)) {
		self.tailscalePreferenceWindow = tailscalePreferenceWindow
	}

	func resolve(
		_ target: Umbreld.Target,
		excluding excludedHost: String? = nil,
		verify: @escaping Verify
	) async throws -> String {
		try Task.checkCancellation()
		let candidates = target.hosts.filter { $0.caseInsensitiveCompare(excludedHost ?? "") != .orderedSame }
		guard !candidates.isEmpty else { throw EndpointResolutionError.unavailable }
		let key = ResolutionKey(deviceId: target.deviceId, hosts: candidates.map { $0.lowercased() }.sorted())

		if let winner = winners[target.deviceId],
			candidates.contains(where: { $0.caseInsensitiveCompare(winner) == .orderedSame })
		{
			return winner
		}
		if excludedHost == nil, let task = resolutionTasks[key] {
			let winner = try await task.value
			try Task.checkCancellation()
			return winner
		}

		let task = Task<String, Error> {
			try await Self.firstPreferredVerified(
				deviceId: target.deviceId,
				hosts: candidates,
				tailscalePreferenceWindow: tailscalePreferenceWindow,
				verify: verify
			)
		}
		if excludedHost == nil { resolutionTasks[key] = task }
		defer {
			if excludedHost == nil { resolutionTasks[key] = nil }
		}

		let winner = try await task.value
		try Task.checkCancellation()
		winners[target.deviceId] = winner
		return winner
	}

	func invalidate(deviceId: String, host: String) {
		guard winners[deviceId]?.caseInsensitiveCompare(host) == .orderedSame else { return }
		winners[deviceId] = nil
	}

	// A system network-path change can make the cached route obsolete without first
	// producing a request failure. Clear only this device's winner so its next request
	// races the same verified candidates again.
	func invalidate(deviceId: String) {
		winners[deviceId] = nil
	}

	// Prefer Tailscale only when it proves the saved device promptly. If its probes
	// finish unsuccessfully, fall back locally immediately. If they are merely slow,
	// open the race to every candidate after the bounded preference window. All paths
	// still pass through the same identity verifier below; address class alone never
	// authorizes a connection.
	private static func firstPreferredVerified(
		deviceId: String,
		hosts: [String],
		tailscalePreferenceWindow: Duration,
		verify: @escaping Verify
	) async throws -> String {
		let tailscaleHosts = hosts.filter(SavedDevice.isTailscaleAddress)
		let localHosts = hosts.filter { !SavedDevice.isTailscaleAddress($0) }
		guard !tailscaleHosts.isEmpty, !localHosts.isEmpty else {
			return try await firstVerified(deviceId: deviceId, hosts: hosts, verify: verify)
		}

		do {
			return try await firstVerified(
				deviceId: deviceId,
				hosts: tailscaleHosts,
				within: tailscalePreferenceWindow,
				verify: verify
			)
		} catch is CancellationError {
			throw CancellationError()
		} catch is PreferenceWindowExpired {
			// The tunnel has not failed; it simply did not answer within its preference
			// window. Race it again with local routes so the first verified path wins.
			return try await firstVerified(deviceId: deviceId, hosts: hosts, verify: verify)
		} catch let tailscaleRejection as EndpointRejection {
			do {
				return try await firstVerified(deviceId: deviceId, hosts: localHosts, verify: verify)
			} catch is CancellationError {
				throw CancellationError()
			} catch let localRejection as EndpointRejection {
				throw localRejection.priority > tailscaleRejection.priority
					? localRejection : tailscaleRejection
			} catch is EndpointResolutionError {
				throw tailscaleRejection
			} catch {
				throw error
			}
		} catch is EndpointResolutionError {
			return try await firstVerified(deviceId: deviceId, hosts: localHosts, verify: verify)
		} catch {
			throw error
		}
	}

	private static func firstVerified(
		deviceId: String,
		hosts: [String],
		within preferenceWindow: Duration,
		verify: @escaping Verify
	) async throws -> String {
		try await withThrowingTaskGroup(of: String.self) { group in
			group.addTask {
				try await firstVerified(deviceId: deviceId, hosts: hosts, verify: verify)
			}
			group.addTask {
				try await Task.sleep(for: preferenceWindow)
				throw PreferenceWindowExpired.expired
			}
			defer { group.cancelAll() }
			guard let host = try await group.next() else {
				throw EndpointResolutionError.unavailable
			}
			return host
		}
	}

	private static func firstVerified(
		deviceId: String,
		hosts: [String],
		verify: @escaping Verify
	) async throws -> String {
		try await withThrowingTaskGroup(of: EndpointAttempt.self) { group in
			for host in hosts {
				group.addTask {
					guard !Task.isCancelled else { return .unavailable }
					switch await verify(host, deviceId) {
					case .verified where !Task.isCancelled:
						return .verified(host)
					case .verified, .unavailable:
						return .unavailable
					case .rejected(let rejection):
						return .rejected(rejection)
					}
				}
			}

			var strongestRejection: EndpointRejection?
			for try await result in group {
				switch result {
				case .verified(let host):
					group.cancelAll()
					return host
				case .rejected(let rejection):
					if strongestRejection == nil || rejection.priority > strongestRejection!.priority {
						strongestRejection = rejection
					}
				case .unavailable:
					break
				}
			}
			try Task.checkCancellation()
			if let strongestRejection { throw strongestRejection }
			throw EndpointResolutionError.unavailable
		}
	}
}
