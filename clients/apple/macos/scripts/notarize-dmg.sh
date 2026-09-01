#!/bin/bash
# Notarizes and staples an already signed DMG. This is the only release script
# that contacts Apple, and it runs only when invoked explicitly.
set -euo pipefail

if [[ $# -ne 2 ]]; then
	echo "Usage: bash scripts/notarize-dmg.sh <notary-keychain-profile> <path-to-dmg>" >&2
	exit 1
fi

NOTARY_PROFILE="$1"
DMG="$2"

if [[ ! -f "$DMG" ]]; then
	echo "DMG not found: $DMG" >&2
	exit 1
fi

if ! codesign --verify --verbose=2 "$DMG"; then
	echo "The DMG must have a valid Developer ID signature before notarization" >&2
	exit 1
fi

xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

echo "Ready to share privately: $DMG"
