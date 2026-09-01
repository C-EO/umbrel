import SwiftUI
import UmbrelKit

// The Apps tab: the full grid of installed apps over the wallpaper, an app/update count,
// and links into the Umbrel App Store. Unlike Home, the icons sit directly on the
// wallpaper with no card behind them.
struct AppsView: View {
	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private var columns: [GridItem] {
		Array(repeating: GridItem(.flexible(), spacing: 4), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4)
	}

	var body: some View {
		ScrollView(showsIndicators: false) {
			VStack(alignment: .leading, spacing: 24) {
				header
				grid
				if model.canManageApps { storeButton }
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, Theme.contentInset)
			.padding(.top, 56)
			.padding(.bottom, 32)
		}
		.refreshable {
			await model.refreshVisibleData(for: .apps, force: true)
		}
		.background { WallpaperBackground(image: model.wallpaperImage) }
		.overlay(alignment: .top) { WallpaperTopGradient() }
	}

	// "Apps" + "N apps · M updates", with a handoff to umbrelOS when there
	// are updates. umbrelOS already shows release notes, individual updates, and
	// update progress, so the native app does not duplicate that management UI.
	@ViewBuilder
	private var header: some View {
		if dynamicTypeSize.isAccessibilitySize {
			VStack(alignment: .leading, spacing: 16) {
				headerTitle
				updateButton
			}
			.animation(reduceMotion ? nil : .default, value: model.updateCount)
		} else {
			HStack(alignment: .center, spacing: 24) {
				headerTitle
				Spacer(minLength: 8)
				updateButton
			}
			.animation(reduceMotion ? nil : .default, value: model.updateCount)
		}
	}

	private var headerTitle: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Apps")
				.font(.largeTitle.bold())
				.foregroundStyle(.white)
			// Empty until the first load so we never flash "0 apps".
			if model.didLoad {
				Text(subtitle)
					.font(.subheadline.weight(.medium))
					.foregroundStyle(.white)
			}
		}
	}

	@ViewBuilder
	private var updateButton: some View {
		if model.canManageApps, model.updateCount > 0 {
			PillButton(title: "View Updates") {
				Task {
					if let url = await model.dashboardURLForOpening(
						path: "/app-store",
						queryItems: [URLQueryItem(name: "dialog", value: "updates")]
					) {
						openURL(url)
					}
				}
			}
			.transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.9)))
		}
	}

	private var subtitle: String {
		let count = model.installedApps.count
		let appsText = count == 1 ? "1 app" : "\(count) apps"
		guard model.canManageApps, model.updateCount > 0 else { return appsText }
		let updates = model.updateCount == 1 ? "1 update" : "\(model.updateCount) updates"
		return "\(appsText) · \(updates)"
	}

	// Every installed app, four per row, icons directly on the wallpaper (white labels).
	private var grid: some View {
		LazyVGrid(columns: columns, spacing: 4) {
			ForEach(model.installedApps) { app in
				AppTileButton(app: app, labelColor: .white)
					.frame(maxWidth: .infinity)
					.frame(height: 100)
			}
		}
	}

	private var storeButton: some View {
		Button {
			Task {
				if let url = await model.dashboardURLForOpening(path: "/app-store") { openURL(url) }
			}
		} label: {
			HStack(spacing: 4) {
				Image(systemName: "circle.grid.2x2")
				Text("Open Umbrel App Store")
			}
			.font(.footnote.weight(.semibold))
			.foregroundStyle(.white)
			.padding(.horizontal, 16)
			.frame(minHeight: 52)
			// This action lives in scrolling content, so use the same stable cached
			// wallpaper frost as the Library cards instead of live Liquid Glass.
			.background {
				FrostBackground(shape: Capsule(), wallpaper: model.blurredWallpaper)
			}
			.glassGlint(in: Capsule())
		}
		.buttonStyle(.plain)
		.frame(maxWidth: .infinity)
	}
}
