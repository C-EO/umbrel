import ImageIO
import SwiftUI
import UIKit
import UmbrelKit

// Wallpaper ids are content-stable across Umbrels, so one disk cache serves every device.
// Memory is deliberately evictable: the active model retains what it is showing, while
// NSCache can discard other decoded bitmaps under pressure and recreate them from disk.
@MainActor
final class WallpaperStore {
	static let shared = WallpaperStore()

	private enum Variant {
		case fullScreen
		case deviceCard

		var rendition: Umbreld.WallpaperImageRendition {
			switch self {
			case .fullScreen: .large
			case .deviceCard: .medium
			}
		}

		var suffix: String {
			switch self {
			case .fullScreen: "large"
			case .deviceCard: "medium"
			}
		}

		var maxPixelSize: Int {
			switch self {
			case .fullScreen: 2_880
			case .deviceCard: 1_440
			}
		}
	}

	private static let blurMaxPixelSize = 1_440
	private let memory: NSCache<NSString, UIImage> = {
		let cache = NSCache<NSString, UIImage>()
		cache.countLimit = 12
		cache.totalCostLimit = 64 * 1_024 * 1_024
		return cache
	}()
	private let disk = WallpaperDiskCache()

	// SwiftUI recreates MainModel when the user leaves and re-enters a device. A
	// synchronous memory hit lets that new screen render its wallpaper immediately;
	// disk and network work remain asynchronous below.
	func memoryCached(id: String) -> UIImage? {
		memory.object(forKey: cacheKey(id: id, variant: .fullScreen) as NSString)
	}

	func memoryCachedCard(id: String) -> UIImage? {
		memory.object(forKey: cacheKey(id: id, variant: .deviceCard) as NSString)
	}

	func memoryBlurred(id: String) -> UIImage? {
		memory.object(forKey: "\(id)-blur" as NSString)
	}

	func cached(id: String) async -> UIImage? {
		await cached(id: id, variant: .fullScreen)
	}

	func cachedCard(id: String) async -> UIImage? {
		if let image = await cached(id: id, variant: .deviceCard) { return image }
		// A prior full-screen load is also a valid compressed source for a smaller card.
		guard let data = await disk.data(for: cacheKey(id: id, variant: .fullScreen)),
			let prepared = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: Variant.deviceCard.maxPixelSize
			)
		else { return nil }
		storeInMemory(prepared.image, for: cacheKey(id: id, variant: .deviceCard))
		return prepared.image
	}

	func load(id: String, target: Umbreld.Target) async -> UIImage? {
		guard let image = await load(id: id, target: target, variant: .fullScreen)
		else { return nil }
		_ = await blurred(id: id)
		return image
	}

	func loadCard(id: String, target: Umbreld.Target) async -> UIImage? {
		if let image = await cachedCard(id: id) { return image }
		return await load(id: id, target: target, variant: .deviceCard)
	}

	func blurred(id: String) async -> UIImage? {
		let key = "\(id)-blur"
		if let hit = memory.object(forKey: key as NSString) { return hit }
		if let data = await disk.data(for: key),
			let prepared = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: Self.blurMaxPixelSize
			)
		{
			storeInMemory(prepared.image, for: key)
			return prepared.image
		}
		// Decode a smaller copy directly from the compressed source before blurring it.
		// The frost is intentionally soft and does not need the full-screen pixel count.
		let sourceData: Data?
		if let fullScreen = await disk.data(for: cacheKey(id: id, variant: .fullScreen)) {
			sourceData = fullScreen
		} else {
			sourceData = await disk.data(for: cacheKey(id: id, variant: .deviceCard))
		}
		guard let data = sourceData,
			let source = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: Self.blurMaxPixelSize
			),
			let result = await WallpaperImageProcessor.blur(
				source,
				radius: 40
			)
		else { return nil }
		storeInMemory(result.image, for: key)
		await disk.store(result.encodedData, for: key)
		return result.image
	}

	private func cached(id: String, variant: Variant) async -> UIImage? {
		let key = cacheKey(id: id, variant: variant)
		if let hit = memory.object(forKey: key as NSString) { return hit }
		guard let data = await disk.data(for: key),
			let prepared = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: variant.maxPixelSize
			)
		else { return nil }
		storeInMemory(prepared.image, for: key)
		return prepared.image
	}

	private func load(id: String, target: Umbreld.Target, variant: Variant) async -> UIImage? {
		if let hit = await cached(id: id, variant: variant) { return hit }
		let key = cacheKey(id: id, variant: variant)
		let preferred = await fetch(
			id: id,
			target: target,
			rendition: variant.rendition,
			maxPixelSize: variant.maxPixelSize
		)
		let loaded: (data: Data, image: PreparedWallpaperImage)?
		if let preferred {
			loaded = preferred
		} else if !Task.isCancelled {
			loaded = await fetch(
				id: id,
				target: target,
				rendition: .jpegFallback,
				maxPixelSize: variant.maxPixelSize
			)
		} else {
			loaded = nil
		}
		guard let loaded else { return nil }
		storeInMemory(loaded.image.image, for: key)
		await disk.store(loaded.data, for: key)
		return loaded.image.image
	}

	private func fetch(
		id: String,
		target: Umbreld.Target,
		rendition: Umbreld.WallpaperImageRendition,
		maxPixelSize: Int
	) async -> (data: Data, image: PreparedWallpaperImage)? {
		do {
			let data = try await Umbreld.wallpaperData(
				target: target,
				id: id,
				rendition: rendition
			)
			try Task.checkCancellation()
			guard let image = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: maxPixelSize
			) else { return nil }
			return (data, image)
		} catch {
			return nil
		}
	}

	private func cacheKey(id: String, variant: Variant) -> String {
		"\(id)-\(variant.suffix)"
	}

	private func storeInMemory(_ image: UIImage, for key: String) {
		let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
		memory.setObject(image, forKey: key as NSString, cost: cost)
	}
}

// UIImage is immutable for this pipeline after preparation. The wrapper documents the
// one controlled concurrency boundary: workers create it, then MainActor owns and shows it.
private struct PreparedWallpaperImage: @unchecked Sendable {
	let image: UIImage
}

private struct PreparedWallpaperBlur: @unchecked Sendable {
	let image: UIImage
	let encodedData: Data
}

private enum WallpaperImageProcessor {
	// Image I/O creates a bounded, immediately decoded bitmap without first inflating the
	// original 5K JPEG. It also handles the AVIF renditions on supported Apple platforms.
	static func decode(_ data: Data, maxPixelSize: Int) async -> PreparedWallpaperImage? {
		let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
		guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
			return nil
		}
		let thumbnailOptions = [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceCreateThumbnailWithTransform: true,
			kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
			kCGImageSourceShouldCacheImmediately: true,
		] as CFDictionary
		guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions)
		else { return nil }
		return PreparedWallpaperImage(image: UIImage(cgImage: image))
	}

	static func blur(_ image: PreparedWallpaperImage, radius: CGFloat) async -> PreparedWallpaperBlur? {
		guard let blurred = image.image.gaussianBlurred(radius: radius),
			let encodedData = blurred.jpegData(compressionQuality: 0.9)
		else { return nil }
		return PreparedWallpaperBlur(image: blurred, encodedData: encodedData)
	}
}

private actor WallpaperDiskCache {
	private let directory: URL
	private var directoryReady = false

	init() {
		let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
		// This cache version stores bounded AVIF/JPEG sources and smaller blur outputs.
		directory = caches.appendingPathComponent("wallpapers-v2", isDirectory: true)
	}

	func data(for key: String) -> Data? {
		try? Data(contentsOf: fileURL(key))
	}

	func store(_ data: Data, for key: String) {
		if !directoryReady {
			guard (try? FileManager.default.createDirectory(
				at: directory,
				withIntermediateDirectories: true
			)) != nil else { return }
			directoryReady = true
		}
		try? data.write(to: fileURL(key), options: .atomic)
	}

	private func fileURL(_ key: String) -> URL {
		// Wallpaper ids are a controlled numeric preset set, so they're safe as filenames.
		directory.appendingPathComponent(key, isDirectory: false).appendingPathExtension("image")
	}
}
