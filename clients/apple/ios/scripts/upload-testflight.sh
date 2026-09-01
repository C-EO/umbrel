#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(/usr/bin/git -C "$IOS_DIR" rev-parse --show-toplevel)"
XCODEGEN_BIN="$(command -v xcodegen || true)"
SYSTEM_TOOL_PATH="/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -z "$XCODEGEN_BIN" ]]; then
	echo "xcodegen is required. Install it with: brew install xcodegen" >&2
	exit 1
fi

if [[ -n "$(/usr/bin/git -C "$REPO_ROOT" status --porcelain)" ]]; then
	echo "Refusing to upload from a dirty worktree. Commit and push the release first." >&2
	exit 1
fi

BUILD_NUMBERS="$(
	/usr/bin/awk '/CURRENT_PROJECT_VERSION:/ { gsub(/"/, "", $2); print $2 }' "$IOS_DIR/project.yml" \
		| /usr/bin/sort -u
)"
if [[ "$(echo "$BUILD_NUMBERS" | /usr/bin/wc -l | /usr/bin/tr -d ' ')" != "1" ]]; then
	echo "The app and extension must use the same CURRENT_PROJECT_VERSION." >&2
	exit 1
fi
BUILD_NUMBER="$BUILD_NUMBERS"

RELEASE_DIR="$(/usr/bin/mktemp -d "/tmp/umbrel-testflight-${BUILD_NUMBER}.XXXXXX")"
ARCHIVE_PATH="$RELEASE_DIR/Umbrel.xcarchive"
EXPORT_PATH="$RELEASE_DIR/export"
EXPORT_OPTIONS="$RELEASE_DIR/ExportOptions.plist"

/usr/bin/plutil -create xml1 "$EXPORT_OPTIONS"
/usr/bin/plutil -insert destination -string upload "$EXPORT_OPTIONS"
/usr/bin/plutil -insert manageAppVersionAndBuildNumber -bool false "$EXPORT_OPTIONS"
/usr/bin/plutil -insert method -string app-store-connect "$EXPORT_OPTIONS"
/usr/bin/plutil -insert signingStyle -string automatic "$EXPORT_OPTIONS"
/usr/bin/plutil -insert teamID -string JABS8D63XG "$EXPORT_OPTIONS"
/usr/bin/plutil -insert uploadSymbols -bool true "$EXPORT_OPTIONS"

cd "$IOS_DIR"
"$XCODEGEN_BIN" generate

# Xcode's App Store export invokes Apple's /usr/bin/rsync as a client, which then
# resolves a server-side `rsync` from PATH. Homebrew rsync is flag-incompatible
# with Apple's copy step, so keep the entire distribution pipeline on system tools.
/usr/bin/env PATH="$SYSTEM_TOOL_PATH" /usr/bin/xcodebuild \
	-project Umbrel.xcodeproj \
	-scheme Umbrel \
	-configuration Release \
	-destination generic/platform=iOS \
	-archivePath "$ARCHIVE_PATH" \
	-allowProvisioningUpdates \
	archive

/usr/bin/env PATH="$SYSTEM_TOOL_PATH" /usr/bin/xcodebuild \
	-exportArchive \
	-archivePath "$ARCHIVE_PATH" \
	-exportPath "$EXPORT_PATH" \
	-exportOptionsPlist "$EXPORT_OPTIONS" \
	-allowProvisioningUpdates

echo "Uploaded TestFlight build $BUILD_NUMBER."
echo "Release artifacts: $RELEASE_DIR"
