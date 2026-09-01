import Foundation

enum PhotoBackupSharedFileRead<Value> {
	case found(Value)
	case missing
	case unavailable
}

// Small operational values shared by the iOS app and PhotoKit extension live as
// individual files rather than preferences. They contain device identity, a backup
// source name, and photo statistics, so treating them as app data keeps UserDefaults
// limited to actual user preferences.
//
// Both processes use NSFileCoordinator for every access, as Apple requires for shared
// containers. Each write atomically replaces one complete JSON value, so a suspended
// process can never leave another process with a partially written file.
struct PhotoBackupSharedFiles: Sendable {
	let directory: URL

	func read<Value: Decodable>(_ type: Value.Type, from filename: String) -> Value? {
		guard case .found(let value) = readResult(type, from: filename) else { return nil }
		return value
	}

	func readResult<Value: Decodable>(
		_ type: Value.Type,
		from filename: String
	) -> PhotoBackupSharedFileRead<Value> {
		let url = directory.appendingPathComponent(filename)
		var data: Data?
		var accessError: Error?
		var coordinationError: NSError?
		let coordinator = NSFileCoordinator(filePresenter: nil)
		coordinator.coordinate(
			readingItemAt: url,
			options: .withoutChanges,
			error: &coordinationError
		) { coordinatedURL in
			do {
				data = try Data(contentsOf: coordinatedURL)
			} catch {
				accessError = error
			}
		}
		if Self.isMissingFileError(coordinationError) || Self.isMissingFileError(accessError) {
			return .missing
		}
		guard coordinationError == nil, accessError == nil, let data else {
			return .unavailable
		}
		guard let value = try? JSONDecoder().decode(type, from: data) else {
			return .unavailable
		}
		return .found(value)
	}

	private static func isMissingFileError(_ error: Error?) -> Bool {
		guard let error = error as NSError? else { return false }
		return error.domain == NSCocoaErrorDomain
			&& error.code == CocoaError.Code.fileReadNoSuchFile.rawValue
	}

	@discardableResult
	func write<Value: Encodable>(_ value: Value, to filename: String) -> Bool {
		guard let data = try? JSONEncoder().encode(value) else { return false }
		let url = directory.appendingPathComponent(filename)
		var accessError: Error?
		var coordinationError: NSError?
		let coordinator = NSFileCoordinator(filePresenter: nil)
		coordinator.coordinate(
			writingItemAt: url,
			// Atomic Data.write replaces the destination, even on the first write.
			// Apple recommends declaring that intent regardless of whether it exists.
			options: .forReplacing,
			error: &coordinationError
		) { coordinatedURL in
			do {
				// PhotoKit can run the extension while the iPhone is locked. Match the
				// background Keychain policy: encrypted at rest and available only after
				// the first unlock following a reboot.
				try data.write(
					to: coordinatedURL,
					options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
				)
			} catch {
				accessError = error
			}
		}
		return coordinationError == nil && accessError == nil
	}

	@discardableResult
	func remove(_ filename: String) -> Bool {
		coordinateRemoval(of: filename) { _ in true }
	}

	// Read and compare while holding the coordinated write. This prevents an older
	// extension invocation from deleting a newer source-scoped retry request.
	@discardableResult
	func remove<Value: Decodable & Equatable>(
		_ filename: String,
		ifEqualTo expected: Value
	) -> Bool {
		coordinateRemoval(of: filename) { url in
			guard let data = try? Data(contentsOf: url),
				let stored = try? JSONDecoder().decode(Value.self, from: data)
			else { return false }
			return stored == expected
		}
	}

	private func coordinateRemoval(
		of filename: String,
		shouldRemove: (URL) -> Bool
	) -> Bool {
		let url = directory.appendingPathComponent(filename)
		var removed = false
		var accessError: Error?
		var coordinationError: NSError?
		let coordinator = NSFileCoordinator(filePresenter: nil)
		coordinator.coordinate(
			writingItemAt: url,
			options: .forDeleting,
			error: &coordinationError
		) { coordinatedURL in
			guard shouldRemove(coordinatedURL) else { return }
			do {
				if FileManager.default.fileExists(atPath: coordinatedURL.path) {
					try FileManager.default.removeItem(at: coordinatedURL)
				}
				removed = true
			} catch {
				accessError = error
			}
		}
		return coordinationError == nil && accessError == nil && removed
	}
}
