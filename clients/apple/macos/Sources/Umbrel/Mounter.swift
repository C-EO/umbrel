import AppKit
import Foundation
import NetFS

// SMB mounting via NetFSMountURLSync, called in-process (no helper binary needed).
//
// Why NetFSMountURLSync over the alternatives:
//  - osascript mount volume: doesn't return the mount path, password visible in the URL
//  - mount_smbfs: needs sudo, password visible in process args
//  - NetFSMountURLSync: no sudo, auto-manages /Volumes/, and returns the ACTUAL mount
//    path. That matters because macOS appends "-1", "-2" etc. on name conflicts (two
//    Umbrels both sharing "Documents" mount at /Volumes/Documents and /Volumes/Documents-1).
//
// On the first mount to a new host macOS shows a one-time "connect to server" dialog;
// after the user approves, a Keychain entry makes all future mounts silent. Background
// (health check) mounts pass silent=true so failures never pop dialogs.
enum Mounter {
	private static let blockingQueue = DispatchQueue(
		label: "com.umbrel.app.smb-filesystem",
		attributes: .concurrent
	)

	struct MountError: Error, LocalizedError {
		let message: String
		var errorDescription: String? { message }
	}

	struct MountedShare: Sendable {
		let host: String
		let sharename: String
		let path: String
	}

	// Blocks until the mount completes, so it runs off the main thread.
	// Returns the actual mount path.
	static func mount(
		host: String,
		sharename: String,
		username: String,
		password: String,
		forceNewSession: Bool,
		silent: Bool
	) async throws -> String {
		try validate(sharename: sharename)

		var components = URLComponents()
		components.scheme = "smb"
		components.host = host
		components.path = "/\(sharename)"
		guard let url = components.url else {
			throw MountError(message: "Failed to build SMB URL for \(sharename)")
		}

		return try await withCheckedThrowingContinuation { continuation in
			blockingQueue.async(qos: .userInitiated) {
				let openOptions = NSMutableDictionary()
				let mountOptions = NSMutableDictionary()
				// NetFS can retain an authenticated server session after its final share
				// unmounts. Start one fresh session when the account or password changes;
				// later shares can reuse it normally.
				if forceNewSession {
					openOptions["ForceNewSession"] = true
				}
				// The kNAUIOptionNoUI constant can't be looked up via the Swift bridge
				// on modern macOS, so the raw key/value are used
				if silent {
					openOptions["UIOption"] = "NoUI"
				}

				var mountpoints: Unmanaged<CFArray>?
				let status = NetFSMountURLSync(
					url as CFURL,
					nil, // let macOS pick the mount point under /Volumes/
					username as CFString,
					password as CFString,
					openOptions,
					mountOptions,
					&mountpoints
				)

				guard status == 0 else {
					continuation.resume(throwing: MountError(message: "Mounting \(sharename) failed (\(status))"))
					return
				}

				if let paths = mountpoints?.takeRetainedValue() as? [String], let path = paths.first {
					continuation.resume(returning: path)
				} else {
					// Mounted but no path reported; fall back to the default location
					continuation.resume(returning: "/Volumes/\(sharename)")
				}
			}
		}
	}

	// Finder mounts outlive this process, so in-memory paths aren't enough after a
	// crash or relaunch. Foundation exposes each network volume's remount URL; use
	// its SMB host to recover every volume belonging to this Umbrel.
	static func mountedShares(hosts: Set<String>) async -> [MountedShare] {
		let normalizedHosts = Set(hosts.map(normalize(host:)))
		guard !normalizedHosts.isEmpty else { return [] }

		return await withCheckedContinuation { (continuation: CheckedContinuation<[MountedShare], Never>) in
			blockingQueue.async(qos: .utility) {
				let key: URLResourceKey = .volumeURLForRemountingKey
				let volumes = FileManager.default.mountedVolumeURLs(
					includingResourceValuesForKeys: [key]
				) ?? []
				let shares: [MountedShare] = volumes.compactMap { volume in
					guard let values = try? volume.resourceValues(forKeys: [key]),
						let remote = values.volumeURLForRemounting,
						remote.scheme?.lowercased() == "smb",
						let host = remote.host,
						normalizedHosts.contains(normalize(host: host)),
						!remote.lastPathComponent.isEmpty
					else { return nil }
					return MountedShare(host: host, sharename: remote.lastPathComponent, path: volume.path)
				}
				continuation.resume(returning: shares)
			}
		}
	}

	static func hostsMatch(_ lhs: String, _ rhs: String) -> Bool {
		normalize(host: lhs) == normalize(host: rhs)
	}

	// Use the same graceful system operation as Finder. If files are still active,
	// report the failure to the caller instead of forcing the volume away underneath
	// them. Apple documents this API as safe to call off the main thread.
	static func unmount(path: String) async throws {
		let url = URL(fileURLWithPath: path, isDirectory: true)
		try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
			blockingQueue.async(qos: .userInitiated) {
				do {
					try NSWorkspace.shared.unmountAndEjectDevice(at: url)
					continuation.resume()
				} catch {
					continuation.resume(throwing: error)
				}
			}
		}
	}

	static func primeNetworkVolumeAccess(path: String) async {
		await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
			blockingQueue.async(qos: .utility) {
				_ = try? FileManager.default.contentsOfDirectory(atPath: path)
				continuation.resume()
			}
		}
	}

	// A share is mounted if its path appears in the kernel mount table. MNT_NOWAIT
	// returns cached info without touching the filesystems, so a stale or dead SMB
	// mount can't block the caller (stat() on a dead mount hangs until the SMB layer
	// times out, and this gets called from the main actor).
	static func isMounted(at path: String) -> Bool {
		var mounts: UnsafeMutablePointer<statfs>?
		let count = getmntinfo(&mounts, MNT_NOWAIT)
		guard count > 0, let mounts else { return false }
		for index in 0..<Int(count) {
			let mountPath = withUnsafeBytes(of: mounts[index].f_mntonname) { raw in
				String(cString: raw.baseAddress!.assumingMemoryBound(to: CChar.self))
			}
			if mountPath == path { return true }
		}
		return false
	}

	// Prevent path traversal: sharenames like "../../etc" could target unexpected paths
	private static func validate(sharename: String) throws {
		if sharename.isEmpty || sharename.contains("/") || sharename.contains("\\") || sharename == "."
			|| sharename == ".." {
			throw MountError(message: "Invalid sharename: \(sharename)")
		}
	}

	private static func normalize(host: String) -> String {
		host.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
	}
}
