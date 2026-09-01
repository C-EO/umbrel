import SwiftUI

// The shared onboarding backdrop: black with two blurred violet glows — a strong one
// bleeding up from the bottom-left and a subtle one off the top-right. Screens layer
// their own content and effects, such as the discovery radar, on top.
struct OnboardingBackground: View {
	// Tint of the glows — violet by default, red for the no-device state.
	var tint: Color = Palette.purple
	var secondaryTint: Color = Palette.purpleLight

	// Coordinate space used to scale the glow positions from a 402pt-wide iPhone.
	private let designSize = CGSize(width: 402, height: 874)

	var body: some View {
		GeometryReader { proxy in
			let scale = proxy.size.width / designSize.width
			ZStack {
				Color.black
				glow(tint, radius: 229, center: CGPoint(x: 7, y: 923), scale: scale)
				glow(secondaryTint.opacity(0.2), radius: 209, center: CGPoint(x: 430, y: 132), scale: scale)
			}
			.frame(width: proxy.size.width, height: proxy.size.height)
		}
		.ignoresSafeArea()
	}

	private func glow(_ color: Color, radius: CGFloat, center: CGPoint, scale: CGFloat) -> some View {
		Circle()
			.fill(color)
			.frame(width: radius * 2 * scale, height: radius * 2 * scale)
			.blur(radius: 170 * scale)
			.position(x: center.x * scale, y: center.y * scale)
	}
}
