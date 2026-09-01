import AppKit
import SwiftUI
import UmbrelKit

// Compact macOS rendering of the account dock used by the iOS app and umbrelOS.
// The interaction, account ordering, gradients, and glass refraction intentionally
// match iOS; only the dimensions are reduced to fit the menu-bar panel.
struct UmbrelAccountPicker: View {
	let accounts: [Umbreld.Account]
	let target: Umbreld.Target
	let onSelectionChange: (Umbreld.Account) -> Void

	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.accessibilityReduceTransparency) private var reduceTransparency
	@State private var selectedUserId: String
	@State private var hoveredUserId: String?

	private let avatarSize: CGFloat = 72
	private let lensSize: CGFloat = 100
	private let accountSpacing: CGFloat = 12
	private let lensBevel: CGFloat = 32
	private let lensRefraction: CGFloat = 23
	private let lensChroma: CGFloat = 0.2

	init(
		accounts: [Umbreld.Account],
		target: Umbreld.Target,
		selectedUserId: String? = nil,
		onSelectionChange: @escaping (Umbreld.Account) -> Void
	) {
		self.accounts = accounts
		self.target = target
		self.onSelectionChange = onSelectionChange
		_selectedUserId = State(
			initialValue: selectedUserId
				?? accounts.first(where: { $0.userId == "0" })?.userId
				?? accounts.first?.userId
				?? ""
		)
	}

	private var arrangedAccounts: [Umbreld.Account] {
		guard let owner = accounts.first(where: { $0.userId == "0" }) else { return accounts }
		let members = accounts.filter { $0.userId != owner.userId }
		var left: [Umbreld.Account] = []
		var right: [Umbreld.Account] = []
		for (index, member) in members.enumerated() {
			if index.isMultiple(of: 2) { right.append(member) } else { left.append(member) }
		}
		return Array(left.reversed()) + [owner] + right
	}

	private var selectedIndex: Int {
		arrangedAccounts.firstIndex(where: { $0.userId == selectedUserId }) ?? 0
	}

	private var activeIndex: Int {
		hoveredUserId.flatMap { id in
			arrangedAccounts.firstIndex(where: { $0.userId == id })
		} ?? selectedIndex
	}

	private var activeAccount: Umbreld.Account? {
		arrangedAccounts[safe: activeIndex]
	}

	private var accountStride: CGFloat { avatarSize + accountSpacing }
	private var lensOffset: CGFloat { CGFloat(activeIndex - selectedIndex) * accountStride }

	var body: some View {
		VStack(spacing: 0) {
			GeometryReader { geometry in
				ZStack {
					positionedInteractiveStrip(in: geometry.size)
						// Apply the iOS optical model to the one live strip: its center is
						// untouched and only the convex bevel refracts nearby pixels.
						.modifier(
							AccountLensEffect(
								centerX: geometry.size.width / 2 + lensOffset,
								centerY: geometry.size.height / 2,
								radius: lensSize / 2,
								bevel: lensBevel,
								refraction: lensRefraction,
								chroma: lensChroma,
								enabled: !reduceTransparency
							)
						)

					Circle()
						.fill(.white.opacity(reduceTransparency ? 0.08 : 0.025))
						.frame(width: lensSize, height: lensSize)
						.overlay { Circle().strokeBorder(accountGlint, lineWidth: 1) }
						.shadow(color: .black.opacity(0.22), radius: 10, y: 6)
						.offset(x: lensOffset)
						.allowsHitTesting(false)
				}
				.animation(settleAnimation, value: activeIndex)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.clipped()
			}
			.frame(height: 110)

			Text(firstName(activeAccount?.name ?? ""))
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(.white.opacity(0.9))
				.lineLimit(1)
				.truncationMode(.tail)
		}
	}

	private var settleAnimation: Animation? {
		reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.82)
	}

	private func positionedInteractiveStrip(in size: CGSize) -> some View {
		ZStack(alignment: .leading) {
			HStack(spacing: accountSpacing) {
				ForEach(Array(arrangedAccounts.enumerated()), id: \.element.userId) { index, account in
					Button {
						if index == selectedIndex {
							onSelectionChange(account)
						} else {
							select(index)
						}
					} label: {
						AccountAvatar(account: account, target: target, size: avatarSize)
					}
					.buttonStyle(.plain)
					.onHover { hovering in
						if hovering {
							hoveredUserId = account.userId
						} else if hoveredUserId == account.userId {
							hoveredUserId = nil
						}
					}
					.accessibilityLabel(account.name)
					.accessibilityValue(index == selectedIndex ? "Selected" : "")
					.accessibilityHint(index == selectedIndex ? "Selected account" : "Select this account")
				}
			}
			.offset(x: stripOffset(in: size.width))
		}
		.frame(width: size.width, height: size.height, alignment: .leading)
	}

	private func stripOffset(in width: CGFloat) -> CGFloat {
		(width - avatarSize) / 2 - CGFloat(selectedIndex) * accountStride
	}

	private func select(_ index: Int) {
		guard !arrangedAccounts.isEmpty else { return }
		let bounded = min(max(index, 0), arrangedAccounts.count - 1)
		withAnimation(settleAnimation) {
			selectedUserId = arrangedAccounts[bounded].userId
			hoveredUserId = nil
		}
		onSelectionChange(arrangedAccounts[bounded])
	}

	private func firstName(_ name: String) -> String {
		name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? name
	}

	private var accountGlint: AngularGradient {
		AngularGradient(
			gradient: Gradient(stops: [
				.init(color: .white.opacity(0.06), location: 0.0),
				.init(color: .white.opacity(0.55), location: 0.125),
				.init(color: .white.opacity(0.06), location: 0.375),
				.init(color: .white.opacity(0.55), location: 0.625),
				.init(color: .white.opacity(0.06), location: 0.875),
				.init(color: .white.opacity(0.06), location: 1.0),
			]),
			center: .center
		)
	}
}

// Animating the lens center inside the shader keeps the refracted pixels and
// visible rim together as hover moves between accounts.
private struct AccountLensEffect: @MainActor AnimatableModifier {
	var centerX: CGFloat
	let centerY: CGFloat
	let radius: CGFloat
	let bevel: CGFloat
	let refraction: CGFloat
	let chroma: CGFloat
	let enabled: Bool

	var animatableData: CGFloat {
		get { centerX }
		set { centerX = newValue }
	}

	func body(content: Content) -> some View {
		content.layerEffect(
			ShaderLibrary.bundle(.main).accountLens(
				.float2(CGSize(width: centerX, height: centerY)),
				.float(radius),
				.float(bevel),
				.float(refraction),
				.float(chroma)
			),
			maxSampleOffset: CGSize(
				width: refraction * (1 + chroma),
				height: refraction * (1 + chroma)
			),
			isEnabled: enabled
		)
	}
}

private struct AccountAvatar: View {
	let account: Umbreld.Account
	let target: Umbreld.Target
	let size: CGFloat
	@State private var image: NSImage?

	var body: some View {
		ZStack {
			if let image {
				Image(nsImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFill()
			} else {
				Circle().fill(AccountGradient.gradient(for: account.userId))
				Text(account.name.trimmingCharacters(in: .whitespacesAndNewlines).first.map(String.init)?.uppercased() ?? "")
					.font(.system(size: size * 0.48, weight: .regular, design: .serif))
					.foregroundStyle(.white)
					.shadow(color: .black.opacity(0.15), radius: 2, y: 1)
			}
		}
		.frame(width: size, height: size)
		.clipShape(Circle())
		.overlay { Circle().stroke(.white.opacity(0.22), lineWidth: 1) }
		.shadow(color: .black.opacity(0.28), radius: 10, y: 6)
		.accessibilityHidden(true)
		.task(id: avatarLoadKey) {
			image = nil
			guard let path = account.avatarUrl,
				let data = try? await Umbreld.accountAvatarData(target: target, path: path),
				!Task.isCancelled,
				let decoded = NSImage(data: data),
				!Task.isCancelled
			else { return }
			image = decoded
		}
	}

	private var avatarLoadKey: String? {
		account.avatarUrl.map { "\(target.deviceId)\u{0}\($0)" }
	}
}

private extension Collection {
	subscript(safe index: Index) -> Element? {
		indices.contains(index) ? self[index] : nil
	}
}

private enum AccountGradient {
	// Keep this palette and hash in sync with iOS and umbrelOS. Account colours
	// derive from the immutable id, so they stay stable without stored UI state.
	private static let meshes: [LinearGradient] = [
		mesh([(0xFA709A, 0), (0xFEE140, 1)], angle: 90),
		mesh([(0xE14FAD, 0), (0xF9D423, 1)], angle: 0),
		mesh([(0xF83600, 0), (0xF9D423, 1)], angle: 90),
		mesh([(0xFF5858, 0), (0xF09819, 1)], angle: -60),
		mesh([(0xFF0844, 0), (0xFFB199, 1)], angle: 0),
		mesh([(0xF093FB, 0), (0xF5576C, 1)], angle: 120),
		mesh([(0xFF3CAC, 0), (0x562B7C, 0.52), (0x2B86C5, 1)], angle: -225),
		mesh([(0x231557, 0), (0x44107A, 0.29), (0xFF1361, 0.67), (0xFFF800, 1)], angle: -225),
		mesh(
			[
				(0xFCC5E4, 0), (0xFDA34B, 0.15), (0xFF7882, 0.35), (0xC8699E, 0.52),
				(0x7046AA, 0.71), (0x0C1DB8, 0.87), (0x020F75, 1),
			],
			angle: 0
		),
		mesh([(0x3B41C5, 0), (0xA981BB, 0.49), (0xFFC8A9, 1)], angle: 0),
		mesh([(0xB721FF, 0), (0x21D4FD, 1)], angle: -20),
		mesh([(0xAC32E4, 0), (0x7918F2, 0.48), (0x4801FF, 1)], angle: -225),
		mesh([(0xF43B47, 0), (0x453A94, 1)], angle: 0),
		mesh([(0x30CFD0, 0), (0x330867, 1)], angle: 0),
		mesh([(0x007ADF, 0), (0x00ECBC, 1)], angle: 0),
		mesh([(0xD4FFEC, 0), (0x57F2CC, 0.48), (0x4596FB, 1)], angle: -225),
		mesh([(0x2CD8D5, 0), (0xC5C1FF, 0.56), (0xFFBAC3, 1)], angle: -225),
		mesh([(0xD558C8, 0), (0x24D292, 1)], angle: -20),
		mesh([(0x16A085, 0), (0xF4D03F, 1)], angle: -60),
		mesh(
			[
				(0x3F51B1, 0), (0x5A55AE, 0.13), (0x7B5FAC, 0.25), (0x8F6AAE, 0.38),
				(0xA86AA4, 0.5), (0xCC6B8E, 0.62), (0xF18271, 0.75), (0xF3A469, 0.87),
				(0xF7C978, 1),
			],
			angle: 0
		),
	]

	static func gradient(for id: String) -> LinearGradient {
		var hash: Int32 = 0
		for codeUnit in id.utf16 {
			hash = hash &* 31 &+ Int32(codeUnit)
		}
		let index = Int(Swift.abs(Int64(hash)) % Int64(meshes.count))
		return meshes[index]
	}

	private static func mesh(_ stops: [(UInt32, Double)], angle: Double) -> LinearGradient {
		let radians = angle * .pi / 180
		let dx = sin(radians)
		let dy = -cos(radians)
		let length = abs(dx) + abs(dy)
		let start = UnitPoint(x: 0.5 - dx * length / 2, y: 0.5 - dy * length / 2)
		let end = UnitPoint(x: 0.5 + dx * length / 2, y: 0.5 + dy * length / 2)
		return LinearGradient(
			gradient: Gradient(
				stops: stops.map { Gradient.Stop(color: Color(hex: $0.0), location: $0.1) }
			),
			startPoint: start,
			endPoint: end
		)
	}
}
