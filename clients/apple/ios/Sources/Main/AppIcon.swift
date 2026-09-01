import CryptoKit
import Foundation
import SwiftUI
import UIKit

// umbreld serves app icons as external SVG URLs, which AsyncImage/UIImage can't decode.
// We fetch the SVG (cached by URL), render it in a small on-screen WKWebView, and
// snapshot that once to a UIImage cached in memory and on disk. After an icon renders
// once it appears instantly forever after (scrolling, tab switches, next launch), so
// the slow WebKit path only runs the very first time an icon is seen.

// ── Rasterized-icon cache (memory + disk) ──
@MainActor
final class IconCache {
	static let shared = IconCache()

	private let memory = NSCache<NSString, UIImage>()
	private let directory: URL

	init() {
		let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
		directory = caches.appendingPathComponent("app-icons", isDirectory: true)
		memory.countLimit = 128
		memory.totalCostLimit = 32 * 1_024 * 1_024
		try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
	}

	func image(forKey key: String) -> UIImage? {
		let cacheKey = key as NSString
		if let hit = memory.object(forKey: cacheKey) { return hit }
		guard let data = try? Data(contentsOf: diskURL(key)), let image = UIImage(data: data) else { return nil }
		memory.setObject(image, forKey: cacheKey, cost: memoryCost(of: image))
		return image
	}

	func store(_ image: UIImage, forKey key: String) {
		memory.setObject(image, forKey: key as NSString, cost: memoryCost(of: image))
		if let data = image.pngData() { try? data.write(to: diskURL(key), options: .atomic) }
	}

	private func memoryCost(of image: UIImage) -> Int {
		if let cgImage = image.cgImage { return cgImage.bytesPerRow * cgImage.height }
		let pixelWidth = image.size.width * image.scale
		let pixelHeight = image.size.height * image.scale
		return Int(pixelWidth * pixelHeight * 4)
	}

	private func diskURL(_ key: String) -> URL {
		let hash = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
		return directory.appendingPathComponent(hash).appendingPathExtension("png")
	}
}
// ── SVG loading ──
@MainActor
final class SVGStringLoader {
	static let shared = SVGStringLoader()

	private var inFlight: [URL: Task<String?, Never>] = [:]

	func string(for url: URL) async -> String? {
		if let task = inFlight[url] { return await task.value }
		let task = Task { () -> String? in
			await SVGDownload.string(for: url)
		}
		inFlight[url] = task
		let result = await task.value
		inFlight[url] = nil
		return result
	}
}

private enum SVGDownload {
	// The largest first-party gallery icon is currently about 3.3 MB. This keeps
	// legitimate icons working while bounding an untrusted manifest response.
	private static let maximumByteCount = 4 * 1_024 * 1_024

	static func string(for url: URL) async -> String? {
		guard url.scheme?.lowercased() == "https",
			url.host != nil,
			url.user == nil,
			url.password == nil
		else { return nil }

		var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
		request.setValue("image/svg+xml", forHTTPHeaderField: "Accept")

		do {
			let (bytes, response) = try await URLSession.shared.bytes(
				for: request,
				delegate: SVGNoRedirectDelegate()
			)
			guard let response = response as? HTTPURLResponse,
				(200..<300).contains(response.statusCode),
				response.mimeType?.lowercased() == "image/svg+xml",
				response.expectedContentLength <= Int64(maximumByteCount)
			else { return nil }

			var data = Data()
			if response.expectedContentLength > 0 {
				data.reserveCapacity(Int(response.expectedContentLength))
			}
			for try await byte in bytes {
				guard data.count < maximumByteCount else { return nil }
				data.append(byte)
			}
			return String(data: data, encoding: .utf8)
		} catch {
			return nil
		}
	}
}

private final class SVGNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		completionHandler(nil)
	}
}

// A rounded app icon: instant from cache when available, otherwise the umbrelOS
// placeholder plus an on-screen web view that renders the SVG and caches a snapshot.
struct AppIconView: View {
	let url: URL?
	var size: CGFloat = 50
	var corner: CGFloat = 12.5

	@Environment(\.displayScale) private var displayScale
	@State private var image: UIImage?
	@State private var svgRender: SVGRender?

	private struct SVGRender {
		let cacheKey: String
		let svg: String
	}

	// WebKit snapshots at the view's rendered size. Include that pixel size so a
	// small overflow icon is never reused and enlarged in a full-size app card.
	private var cacheKey: String? {
		guard let url else { return nil }
		let pixelSize = Int((size * displayScale).rounded(.up))
		return "\(url.absoluteString)#\(pixelSize)px"
	}

	var body: some View {
		ZStack {
			if let image {
				Image(uiImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFill()
			} else {
				placeholder
				if let svgRender, svgRender.cacheKey == cacheKey {
					SVGWebView(svg: svgRender.svg) { snapshot in
						guard svgRender.cacheKey == cacheKey else { return }
						IconCache.shared.store(snapshot, forKey: svgRender.cacheKey)
						image = snapshot
						self.svgRender = nil
					}
				}
			}
		}
		.frame(width: size, height: size)
		.clipShape(.rect(cornerRadius: corner))
		// Fade freshly rasterized icons in over their placeholder (cached ones are
		// set before first render, so no animation runs for them).
		.animation(.easeOut(duration: 0.25), value: image)
		.task(id: cacheKey) {
			image = nil
			svgRender = nil
			guard let url, let cacheKey else { return }
			if let cached = IconCache.shared.image(forKey: cacheKey) {
				image = cached
				return
			}
			guard let svg = await SVGStringLoader.shared.string(for: url),
				!Task.isCancelled,
				cacheKey == self.cacheKey
			else { return }
			svgRender = SVGRender(cacheKey: cacheKey, svg: svg)
		}
	}

	// The umbrelOS loading/fallback icon (packages/ui assets/app-icon-placeholder.svg),
	// bundled as a vector asset so it renders on the first frame.
	private var placeholder: some View {
		Image("AppIconPlaceholder")
			.resizable()
			.interpolation(.high)
			.scaledToFill()
	}
}
