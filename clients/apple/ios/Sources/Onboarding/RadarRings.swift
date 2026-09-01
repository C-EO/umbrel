import SwiftUI

// The three concentric radar rings shared by the Local Network and Finding screens.
// Each ring has a top-lit violet gradient fill and a top-lit white hairline stroke
// fading to transparent toward the bottom.
struct RadarRings: View {
	var tint: Color = Palette.purple
	private let diameters: [CGFloat] = [359.7, 269, 161]

	private var fill: LinearGradient {
		LinearGradient(colors: [tint.opacity(0.12), tint.opacity(0)], startPoint: .top, endPoint: .bottom)
	}
	private var stroke: LinearGradient {
		LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0)], startPoint: .top, endPoint: .bottom)
	}

	var body: some View {
		ZStack {
			ForEach(diameters, id: \.self) { d in
				Circle()
					.fill(fill)
					.overlay(Circle().stroke(stroke, lineWidth: 1.79))
					.frame(width: d, height: d)
			}
		}
		.frame(width: 360, height: 360)
	}
}
