import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

// Frosted-glass backdrop for cards.
//
// Why not a blur view: a ScrollView composites its content into an isolated layer, so a
// frosted card *inside* the scroll view cannot sample the wallpaper sitting *behind* it.
// Both SwiftUI `.ultraThinMaterial` and UIKit `UIVisualEffectView` render flat gray in
// that arrangement (the gaps between cards still show the wallpaper, which is misleading).
//
// Instead, each card draws a pre-blurred copy of the wallpaper, offset by the card's
// global position so it aligns pixel-for-pixel with the sharp wallpaper behind the scroll
// view — a blurred window into the same image.
//
// Performance: cheap. The Gaussian blur runs once, on the CPU/GPU via Core Image, when
// the wallpaper first loads (see MainModel.blurredWallpaper) and is cached. Per frame,
// and while scrolling, each card only re-reads that cached UIImage and changes an
// `.offset` — no re-blur, so it's effectively free. The cached blur uses a smaller
// rendition than the sharp background because the filter removes fine detail anyway.

extension UIImage {
	// A Gaussian-blurred copy, clamped so edges don't fade to transparent.
	func gaussianBlurred(radius: CGFloat) -> UIImage? {
		guard let ciImage = CIImage(image: self) else { return nil }
		let filter = CIFilter.gaussianBlur()
		filter.inputImage = ciImage.clampedToExtent()
		filter.radius = Float(radius)
		guard let output = filter.outputImage else { return nil }
		let context = CIContext(options: nil)
		guard let cgImage = context.createCGImage(output, from: ciImage.extent) else { return nil }
		return UIImage(cgImage: cgImage)
	}
}

// The card's frosted fill: the pre-blurred wallpaper aligned to the fixed backdrop,
// plus the dark tint, clipped to the card shape.
struct FrostBackground<S: Shape>: View {
	let shape: S
	let wallpaper: UIImage?
	@Environment(\.wallpaperViewportSize) private var viewportSize
	@Environment(\.accessibilityReduceTransparency) private var reduceTransparency

	var body: some View {
		ZStack {
			if reduceTransparency {
				Color(hex: 0x1C1C1E)
			} else if let wallpaper {
				Color.clear
					.overlay(alignment: .topLeading) {
						Image(uiImage: wallpaper)
							.resizable()
							.scaledToFill()
							.frame(width: viewportSize.width, height: viewportSize.height)
					}
					.visualEffect { content, proxy in
						content.offset(
							x: -proxy.frame(in: .global).minX,
							y: -proxy.frame(in: .global).minY
						)
					}
			}
			if !reduceTransparency {
				Theme.card
			}
		}
		.clipShape(shape)
		// clipShape trims the drawing but NOT the hit area: the screen-sized wallpaper
		// image would otherwise blanket the whole screen with an invisible touch target
		// per card, swallowing taps for every view laid out before it. A decorative
		// background must never participate in hit testing.
		.allowsHitTesting(false)
	}
}

// The blurred wallpaper flows down to SectionCard through the environment so the shared
// card view doesn't need to know about the model.
private struct FrostWallpaperKey: EnvironmentKey {
	static let defaultValue: UIImage? = nil
}

private struct WallpaperViewportSizeKey: EnvironmentKey {
	static let defaultValue: CGSize = .zero
}

extension EnvironmentValues {
	var frostWallpaper: UIImage? {
		get { self[FrostWallpaperKey.self] }
		set { self[FrostWallpaperKey.self] = newValue }
	}

	var wallpaperViewportSize: CGSize {
		get { self[WallpaperViewportSizeKey.self] }
		set { self[WallpaperViewportSizeKey.self] = newValue }
	}
}
