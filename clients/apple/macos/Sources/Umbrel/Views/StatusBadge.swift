import SwiftUI

// Concentric rings rippling out from a gradient status icon, anchored to the
// upper-right corner of the device detail page: 19pt center, four 14pt rings, 20pt
// corner inset, staggered ring entrance, and an ongoing outward opacity pulse.
struct StatusBadge: View {
	let icon: NSImage // pre-rendered badge circle, including its glyph and effects
	let ringColor: Color

	private static let centerRadius: CGFloat = 19
	private static let ringWidth: CGFloat = 14
	private static let ringCount = 4
	private static let innerOpacity = 0.15
	private static let outerOpacity = 0.05
	// The center circle sits inset this far from the page's top and right edges
	private static let inset: CGFloat = 20

	@State private var appeared = false
	@State private var pulsing = false

	private var totalSize: CGFloat {
		Self.centerRadius * 2 + Self.ringWidth * 2 * CGFloat(Self.ringCount)
	}

	var body: some View {
		let centerOffset = totalSize / 2 - Self.centerRadius - Self.inset
		ZStack {
			ForEach(0..<Self.ringCount, id: \.self) { index in
				ring(index)
			}

			Image(nsImage: icon)
				.resizable()
				.scaledToFit()
				.frame(width: Self.centerRadius * 2, height: Self.centerRadius * 2)
				.scaleEffect(appeared ? 1 : 0.6)
				.opacity(appeared ? 1 : 0)
				.animation(.spring(duration: 0.35, bounce: 0.35), value: appeared)
		}
		.frame(width: totalSize, height: totalSize)
		// Hang past the page edges so only the inner arcs are visible; the panel's
		// rounded clip crops the overflow
		.offset(x: centerOffset, y: -centerOffset)
		.allowsHitTesting(false)
		.onAppear {
			appeared = true
			pulsing = true
		}
	}

	// Rings ripple in from the center (innermost first) and then pulse outward:
	// 3s ease-in-out cycle,
	// opacity base -> 1.4x base and scale 1 -> 1.04 at the midpoint, staggered
	// 0.15s per ring. The entrance spring owns its own scaleEffect so the two
	// staggered animations never fight over one property.
	private func ring(_ index: Int) -> some View {
		let size = Self.centerRadius * 2 + Self.ringWidth * 2 * CGFloat(Self.ringCount - index)
		let baseOpacity =
			Self.outerOpacity + (Self.innerOpacity - Self.outerOpacity) * Double(index) / Double(Self.ringCount - 1)
		let entranceDelay = Double(Self.ringCount - 1 - index) * 0.06
		let pulseDelay = Double(Self.ringCount - 1 - index) * 0.15

		return Circle()
			.fill(ringColor)
			.frame(width: size, height: size)
			.scaleEffect(appeared ? 1 : 0.6)
			.animation(.spring(duration: 0.35, bounce: 0.35).delay(entranceDelay), value: appeared)
			.scaleEffect(pulsing ? 1.04 : 1)
			.opacity(pulsing ? baseOpacity * 1.4 : baseOpacity)
			.animation(
				.easeInOut(duration: 1.5).repeatForever(autoreverses: true).delay(pulseDelay),
				value: pulsing
			)
	}
}

// Badge appearance per connection state, for saved devices only.
func statusBadgeConfig(for device: Device) -> (key: String, icon: NSImage, ringColor: Color)? {
	guard device.saved, device.reachability != .unverified else { return nil }
	if device.online, device.connection == .connected {
		return (key: "connected", icon: Assets.statusConnected, ringColor: Color(hex: 0x00D061))
	}
	// Staged for the upcoming HTTPS secure-access state:
	// (key: "secure", icon: Assets.statusSecure, ringColor: Palette.blue)
	return (key: "disconnected", icon: Assets.statusDisconnected, ringColor: Color(hex: 0xFF5D41))
}
