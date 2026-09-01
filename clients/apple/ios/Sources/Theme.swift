import SwiftUI

// Brand palette shared across onboarding screens.
enum Palette {
	static let purple = Color(hex: 0x742FF1) // brand violet — glows, subtle buttons
	static let purpleLight = Color(hex: 0xA46EFF) // secondary glow
	static let textMuted = Color(hex: 0x837996) // subtitles / secondary copy
	static let error = Color(hex: 0xF12F59) // no-device / error state
}

extension Color {
	init(hex: UInt32) {
		self.init(
			.sRGB,
			red: Double((hex >> 16) & 0xFF) / 255,
			green: Double((hex >> 8) & 0xFF) / 255,
			blue: Double(hex & 0xFF) / 255
		)
	}
}
