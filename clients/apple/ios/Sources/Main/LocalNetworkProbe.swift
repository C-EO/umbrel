import Foundation
import UmbrelKit

// One-shot probe of the Local Network permission for the main app: starts a short
// browse and reads the only signal iOS provides (denial arrives as a browse error,
// results mean access, silence means the network is merely quiet). Only used after
// onboarding, where the permission was necessarily granted once, so a probe can
// never summon an un-primed permission dialog.
enum LocalNetworkProbe {
	@MainActor
	static func isDenied() async -> Bool {
		let discovery = Discovery()
		var verdict: Bool?
		discovery.onPermissionDenied = { verdict = true }
		discovery.onUpdate = { _ in if verdict == nil { verdict = false } }
		discovery.start()
		defer { discovery.stop() }
		// The denial error lands within moments of the browse starting; give it a
		// generous window, then treat silence as "not denied" (an offline device
		// should read as offline, never as a permission problem)
		for _ in 0..<12 {
			try? await Task.sleep(for: .seconds(0.1))
			if let verdict { return verdict }
		}
		return false
	}
}
