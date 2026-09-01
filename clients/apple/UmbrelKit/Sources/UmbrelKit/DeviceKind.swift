import Foundation

/// The hardware family represented by umbreld's human-readable device model.
///
/// Both Apple apps use this small shared classifier so a newly discovered or
/// offline device cannot render as a different Umbrel model by accident.
public enum UmbrelDeviceKind: Sendable, Equatable {
	case home
	case pro
	case raspberryPi
	case generic

	public init(model: String?) {
		let model = model?.lowercased() ?? ""
		if model.contains("umbrel home") {
			self = .home
		} else if model.contains("umbrel pro") {
			self = .pro
		} else if model.contains("raspberry pi") {
			self = .raspberryPi
		} else {
			self = .generic
		}
	}
}
