import SwiftUI
import UIKit
import UmbrelKit

// Native counterpart to umbrelOS's multi-user dock. SwiftUI owns layout and
// interaction; AccountLens.metal recreates the dock's clear refractive selector
// without adding a frosted material over the avatar.
struct UmbrelAccountPicker: View {
	let accounts: [Umbreld.Account]
	let target: Umbreld.Target
	let onSelectionChange: (Umbreld.Account) -> Void

	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.accessibilityReduceTransparency) private var reduceTransparency
	@State private var selectedUserId: String
	@State private var dragOffset: CGFloat = 0

	private let avatarSize: CGFloat = 112
	private let lensSize: CGFloat = 156
	private let accountSpacing: CGFloat = 18
	private let lensBevel: CGFloat = 50
	private let lensRefraction: CGFloat = 35
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

	private var selectedAccount: Umbreld.Account? {
		arrangedAccounts[safe: selectedIndex]
	}

	private var accountStride: CGFloat { avatarSize + accountSpacing }

	var body: some View {
		VStack(spacing: 0) {
			GeometryReader { geometry in
				ZStack {
					positionedInteractiveStrip(in: geometry.size)
						// Refract the real strip rather than placing a second copy over it. The
						// shader returns untouched pixels outside the lens, so animation and
						// direct manipulation always render from one source.
						.layerEffect(
							ShaderLibrary.accountLens(
								.float2(geometry.size),
								.float(lensSize / 2),
								.float(lensBevel),
								.float(lensRefraction),
								.float(lensChroma)
							),
							maxSampleOffset: CGSize(
								width: lensRefraction * (1 + lensChroma),
								height: lensRefraction * (1 + lensChroma)
							),
							isEnabled: !reduceTransparency
						)

					Circle()
						.fill(.white.opacity(reduceTransparency ? 0.08 : 0.025))
						.frame(width: lensSize, height: lensSize)
						.overlay { Circle().strokeBorder(Theme.glint, lineWidth: 1.25) }
						.shadow(color: .black.opacity(0.22), radius: 14, y: 8)
						.contentShape(Circle())
						.gesture(selectorDrag)
						.accessibilityElement()
						.accessibilityLabel("Account")
						.accessibilityValue(selectedAccount?.name ?? "")
						.accessibilityHint("Swipe up or down to choose another account.")
						.accessibilityAdjustableAction { direction in
							switch direction {
							case .increment: select(selectedIndex + 1)
							case .decrement: select(selectedIndex - 1)
							@unknown default: break
							}
						}
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.clipped()
			}
			.frame(height: 174)

			Text(firstName(selectedAccount?.name ?? ""))
				.font(.subheadline.weight(.semibold))
				.foregroundStyle(.white.opacity(0.9))
				.lineLimit(1)
				.truncationMode(.tail)
				.padding(.top, 2)
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
					.accessibilityLabel(account.name)
					.accessibilityHint(index == selectedIndex ? "Log in" : "Move selector to this account")
					.accessibilityHidden(index == selectedIndex)
				}
			}
			.offset(x: stripOffset(in: size.width))
		}
		.frame(width: size.width, height: size.height, alignment: .leading)
	}

	private func stripOffset(in width: CGFloat) -> CGFloat {
		let centered = (width - avatarSize) / 2 - CGFloat(selectedIndex) * accountStride
		return centered + clampedDragOffset(dragOffset)
	}

	private func clampedDragOffset(_ proposed: CGFloat) -> CGFloat {
		let lastIndex = max(arrangedAccounts.count - 1, 0)
		let minimum = -CGFloat(lastIndex - selectedIndex) * accountStride
		let maximum = CGFloat(selectedIndex) * accountStride
		return min(max(proposed, minimum), maximum)
	}

	private var selectorDrag: some Gesture {
		DragGesture(minimumDistance: 6)
			.onChanged { value in
				dragOffset = clampedDragOffset(value.translation.width)
			}
			.onEnded { value in
				let predicted = clampedDragOffset(value.predictedEndTranslation.width)
				let target = selectedIndex - Int((predicted / accountStride).rounded())
				select(target)
			}
	}

	private func select(_ index: Int) {
		guard !arrangedAccounts.isEmpty else { return }
		let bounded = min(max(index, 0), arrangedAccounts.count - 1)
		// Update the snapped account and live drag offset in one transaction so the
		// normal strip and its refracted rendering follow the exact same animation.
		withAnimation(settleAnimation) {
			selectedUserId = arrangedAccounts[bounded].userId
			dragOffset = 0
		}
		onSelectionChange(arrangedAccounts[bounded])
	}

	private func firstName(_ name: String) -> String {
		name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? name
	}
}

private struct AccountAvatar: View {
	let account: Umbreld.Account
	let target: Umbreld.Target
	let size: CGFloat
	@State private var image: UIImage?

	var body: some View {
		ZStack {
			if let image {
				Image(uiImage: image)
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
		.shadow(color: .black.opacity(0.28), radius: 15, y: 9)
		.accessibilityHidden(true)
		.task(id: avatarLoadKey) {
			image = nil
			guard let path = account.avatarUrl,
				let data = try? await Umbreld.accountAvatarData(target: target, path: path),
				!Task.isCancelled,
				let source = UIImage(data: data),
				let prepared = await source.byPreparingForDisplay(),
				!Task.isCancelled
			else { return }
			image = prepared
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
	// Keep this palette and hash in sync with umbrelOS's AccountAvatar. Account
	// colours are presentation derived from the immutable id, not stored profile data.
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

	// CSS gradient angles are clockwise from up. Extending the line to the
	// square's projected corners reproduces CSS's coverage in SwiftUI.
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
