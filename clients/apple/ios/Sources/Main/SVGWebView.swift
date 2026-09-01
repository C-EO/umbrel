import SwiftUI
import UIKit
import WebKit

// Renders an inline SVG string in a transparent, on-screen WKWebView (the reliable way
// to rasterize SVG on iOS). Aspect ratio is preserved. Pass `onSnapshot` to capture the
// painted result as a UIImage once — app icons use that to cache; folders render live.
struct SVGWebView: UIViewRepresentable {
	let svg: String
	var onSnapshot: ((UIImage) -> Void)? = nil

	func makeUIView(context: Context) -> WKWebView {
		let configuration = WKWebViewConfiguration()
		configuration.websiteDataStore = .nonPersistent()
		configuration.defaultWebpagePreferences.allowsContentJavaScript = false
		let webView = WKWebView(
			frame: CGRect(x: 0, y: 0, width: 64, height: 64),
			configuration: configuration
		)
		webView.isOpaque = false
		webView.backgroundColor = .clear
		webView.scrollView.backgroundColor = .clear
		webView.scrollView.isScrollEnabled = false
		webView.isUserInteractionEnabled = false
		webView.allowsLinkPreview = false
		webView.navigationDelegate = context.coordinator
		context.coordinator.onSnapshot = onSnapshot
		context.coordinator.load(svg, in: webView)
		return webView
	}

	func updateUIView(_ webView: WKWebView, context: Context) {
		context.coordinator.load(svg, in: webView)
	}

	func makeCoordinator() -> Coordinator { Coordinator() }

	final class Coordinator: NSObject, WKNavigationDelegate {
		var onSnapshot: ((UIImage) -> Void)?
		private var loaded: String?
		private var snapshotted = false

		func load(_ svg: String, in webView: WKWebView) {
			guard loaded != svg else { return }
			loaded = svg
			snapshotted = false
			webView.loadHTMLString(html(for: svg), baseURL: nil)
		}

		func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
			guard let onSnapshot, !snapshotted else { return }
			snapshotted = true
			// Let the SVG paint before snapshotting.
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
				let config = WKSnapshotConfiguration()
				config.afterScreenUpdates = true
				webView.takeSnapshot(with: config) { image, _ in
					if let image { onSnapshot(image) }
				}
			}
		}

		func webView(
			_ webView: WKWebView,
			decidePolicyFor navigationAction: WKNavigationAction,
			decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
		) {
			// loadHTMLString uses about:blank for the initial document. Reject every
			// other main-frame navigation requested by untrusted SVG markup.
			let isInlineDocument = navigationAction.request.url?.absoluteString == "about:blank"
			decisionHandler(isInlineDocument ? .allow : .cancel)
		}

		private func html(for svg: String) -> String {
			"""
			<!doctype html><html><head>
			<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
			<style>html,body{margin:0;padding:0;height:100%;background:transparent;overflow:hidden}
			svg{width:100%;height:100%;display:block}</style>
			</head><body>\(svg)</body></html>
			"""
		}
	}
}
