// GPU vendor/model strings come straight from PCI data ("NVIDIA Corporation",
// "Strix Halo [Radeon Graphics / Radeon 8050S Graphics]"). These helpers
// reduce them to names people recognize, shared by Live Usage and
// Settings → Device Info so the same GPU is named the same everywhere.

// Bracket text can list several variants sharing one PCI id ("Radeon RX
// 6800/6800 XT / 6900 XT") — picking any specific variant risks naming a card
// the user doesn't own, so prefer the longest alternative, which carries the
// family name ("Radeon RX 6800") rather than a bare variant.
function bestBracketAlternative(bracket: string) {
	return bracket
		.split('/')
		.map((part) => part.trim())
		.reduce((longest, part) => (part.length > longest.length ? part : longest), '')
}

// Compact display name: prefer the marketing name in brackets and drop a
// leading vendor repeat (display contexts pair it with a vendor badge)
export function cleanGpuName(model: string) {
	const bracket = model.match(/\[([^\]]+)\]/)?.[1]
	const candidate = bracket ? bestBracketAlternative(bracket) : model
	return (candidate || model).replace(/^(NVIDIA|AMD|ATI|Intel)\s+/i, '').trim() || model
}

// Spec-sheet model name: keeps the family/codename outside the brackets and
// pairs it with the marketing name — "Strix Halo [Radeon Graphics / Radeon
// 8050S Graphics]" → "Strix Halo (Radeon 8050S Graphics)"
export function gpuSpecModelName(model: string) {
	const bracket = model.match(/\[([^\]]+)\]/)?.[1]
	if (!bracket) return model
	const prefix = model.replace(/\s*\[[^\]]*\]\s*/, ' ').trim()
	const marketing = bestBracketAlternative(bracket)
	if (!prefix) return marketing || model
	return marketing ? `${prefix} (${marketing})` : prefix
}

// Reduce a PCI vendor string to a badge/prefix-sized name
export function gpuVendorShortName(vendor: string) {
	if (/nvidia/i.test(vendor)) return 'NVIDIA'
	// Word boundaries matter: "Corporation" contains "ati"
	if (/\bamd\b|\bati\b|advanced micro/i.test(vendor)) return 'AMD'
	if (/intel/i.test(vendor)) return 'Intel'
	return vendor.split(/[\s,]/)[0]
}
