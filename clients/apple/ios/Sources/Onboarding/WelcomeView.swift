import SwiftUI

// Onboarding step 2. Hero: title + subtitle up top, the glowing
// 3D Umbrel app icon centered, page dots, and a Continue button at the bottom.
struct WelcomeView: View {
	@Environment(OnboardingModel.self) private var model
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize

	var body: some View {
		VStack(spacing: 0) {
			header.padding(.top, dynamicTypeSize.isAccessibilitySize ? 32 : 72)

			Spacer(minLength: dynamicTypeSize.isAccessibilitySize ? 16 : 0)

			heroIcon
				.frame(width: dynamicTypeSize.isAccessibilitySize ? 120 : 298)

			Spacer(minLength: dynamicTypeSize.isAccessibilitySize ? 16 : 0)

			continueButton
				.padding(.horizontal, 31)
				.padding(.bottom, 8)
		}
	}

	private var header: some View {
		OnboardingHeader(
			title: "Your Umbrel.\nIn your pocket.",
			subtitle: "Manage your Umbrel, launch apps, and keep your photos backed up automatically."
		)
	}

	// Glossy 3D icon. `.screen` blending lets the icon's dark render melt into
	// the background so only the glow shows.
	private var heroIcon: some View {
		Image("UmbrelIconGlow")
			.resizable()
			.scaledToFit()
			.blendMode(.screen)
			.accessibilityHidden(true)
			.entrance()
	}

	private var continueButton: some View {
		OnboardingButton(title: "Continue") {
			model.advance(to: .localNetwork)
		}
		.entrance()
	}
}

// Harness for finessing the welcome screen in the Xcode canvas without running
// the app: background + screen with a standalone model, no discovery.
#Preview("Welcome") {
	ZStack {
		OnboardingBackground()
		WelcomeView()
	}
	.environment(OnboardingModel())
}
