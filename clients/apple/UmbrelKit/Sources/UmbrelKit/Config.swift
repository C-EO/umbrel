import Foundation

// Saved devices persist in Application Support. The bundled macOS app supplies its
// protected App Group container; sandboxed platforms use their private app container.
// Native grants live in the Keychain, never in this file.
public struct Config {
	public enum StorageIssue: String, Error, LocalizedError, Identifiable, Sendable {
		case protectedContainerUnavailable
		case unreadable
		case corruptQuarantined
		case corruptNotQuarantined
		case saveFailed

		public var id: String { rawValue }

		public var title: String {
			switch self {
			case .protectedContainerUnavailable:
				"Umbrel Storage Is Unavailable"
			case .unreadable, .corruptQuarantined, .corruptNotQuarantined:
				"Saved Umbrels Couldn’t Be Loaded"
			case .saveFailed:
				"Umbrel Settings Couldn’t Be Saved"
			}
		}

		public var errorDescription: String? {
			switch self {
			case .protectedContainerUnavailable:
				"Umbrel couldn’t access its protected app storage. Quit and reopen the app, then try again."
			case .unreadable:
				"Umbrel couldn’t read its saved-device settings and won’t overwrite them. Check that this device has available storage, then reopen the app."
			case .corruptQuarantined:
				"The damaged settings file was moved aside instead of being replaced. You can reconnect your Umbrels safely."
			case .corruptNotQuarantined:
				"Umbrel found a damaged settings file but couldn’t move it aside, so it won’t overwrite it. Check that this device has available storage, then reopen the app."
			case .saveFailed:
				"Your change wasn’t saved. Check that this device has available storage, then try again."
			}
		}
	}

	public struct LoadResult {
		public let config: Config
		public let issue: StorageIssue?
	}

	public private(set) var savedDevices: [String: SavedDevice] = [:]
	private let fileURL: URL
	private let allowsWrites: Bool

	private init(
		savedDevices: [String: SavedDevice] = [:],
		fileURL: URL,
		allowsWrites: Bool = true
	) {
		self.savedDevices = savedDevices
		self.fileURL = fileURL
		self.allowsWrites = allowsWrites
	}

	private struct FileShape: Codable {
		var savedDevices: [String: SavedDevice]
	}

	private static var defaultFileURL: URL {
		FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
			.appendingPathComponent("Umbrel", isDirectory: true)
			.appendingPathComponent("config.json")
	}

	public static func load() -> LoadResult {
		load(from: defaultFileURL)
	}

	// A nonsandboxed macOS app can use the ordinary Application Support directory,
	// but other processes running as the user can modify files there. A signed App
	// Group container receives system-level protection on current macOS releases.
	// Resolve that container through FileManager rather than constructing its path.
	public static func load(applicationGroupIdentifier: String) -> LoadResult {
		guard let container = FileManager.default.containerURL(
			forSecurityApplicationGroupIdentifier: applicationGroupIdentifier
		) else {
			return LoadResult(
				config: Config(fileURL: defaultFileURL, allowsWrites: false),
				issue: .protectedContainerUnavailable
			)
		}
		let fileURL = container
			.appendingPathComponent("Library/Application Support/Umbrel", isDirectory: true)
			.appendingPathComponent("config.json")
		return load(from: fileURL)
	}

	static func load(from fileURL: URL) -> LoadResult {
		guard FileManager.default.fileExists(atPath: fileURL.path) else {
			return LoadResult(config: Config(fileURL: fileURL), issue: nil)
		}

		let data: Data
		do {
			data = try Data(contentsOf: fileURL)
		} catch {
			return LoadResult(
				config: Config(fileURL: fileURL, allowsWrites: false),
				issue: .unreadable
			)
		}

		do {
			let file = try JSONDecoder().decode(FileShape.self, from: data)
			return LoadResult(
				config: Config(savedDevices: file.savedDevices, fileURL: fileURL),
				issue: nil
			)
		} catch {
			let quarantineURL = fileURL.deletingPathExtension()
				.appendingPathExtension("corrupt-\(UUID().uuidString).json")
			do {
				try FileManager.default.moveItem(at: fileURL, to: quarantineURL)
				return LoadResult(
					config: Config(fileURL: fileURL),
					issue: .corruptQuarantined
				)
			} catch {
				return LoadResult(
					config: Config(fileURL: fileURL, allowsWrites: false),
					issue: .corruptNotQuarantined
				)
			}
		}
	}

	public mutating func save(_ device: SavedDevice) throws {
		var updated = savedDevices
		updated[device.id] = device
		try flush(updated)
		savedDevices = updated
	}

	public mutating func remove(id: String) throws {
		guard savedDevices[id] != nil else { return }
		var updated = savedDevices
		updated.removeValue(forKey: id)
		try flush(updated)
		savedDevices = updated
	}

	// Apply a mutation to a saved device, skipping the disk write when nothing changed.
	public mutating func update(id: String, _ mutate: (inout SavedDevice) -> Void) throws {
		guard var device = savedDevices[id] else { return }
		mutate(&device)
		guard device != savedDevices[id] else { return }
		var updated = savedDevices
		updated[id] = device
		try flush(updated)
		savedDevices = updated
	}

	private func flush(_ savedDevices: [String: SavedDevice]) throws {
		guard allowsWrites else { throw StorageIssue.saveFailed }
		do {
			let dir = fileURL.deletingLastPathComponent()
			try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
			let encoder = JSONEncoder()
			encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
			let data = try encoder.encode(FileShape(savedDevices: savedDevices))
			// .atomic is write-to-temp-then-rename, so a crash mid-write can't corrupt the file.
			try data.write(to: fileURL, options: .atomic)
		} catch {
			throw StorageIssue.saveFailed
		}
	}
}
