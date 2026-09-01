# Umbrel (iOS)

The iPhone companion app for connecting to umbrelOS, opening apps, and backing up
the photo library. Shared networking and authentication live in
[UmbrelKit](../UmbrelKit).

## Development

The deployment target is iOS 26.5. The generated Xcode project is not committed.

```bash
brew install xcodegen
cd clients/apple/ios
xcodegen generate
open Umbrel.xcodeproj
```

Build from Xcode or the command line:

```bash
xcodebuild -project Umbrel.xcodeproj -scheme Umbrel \
  -destination 'generic/platform=iOS Simulator' build
```

## TestFlight

Increment `CURRENT_PROJECT_VERSION` in `project.yml`, commit it, and run from a
clean worktree:

```bash
./scripts/upload-testflight.sh
```

The script generates the project, archives the app and PhotoKit extension, and
uploads the signed build to App Store Connect.

## Photo backup transport

PhotoKit performs queued uploads outside the app's custom HTTPS transport, so
backup uses HTTP only to the Tailscale address verified during setup. That
destination is pinned for queued jobs; uploads pause instead of being retargeted
when it is unreachable.

## Physical-device release check

Test PhotoKit uploads on an iPhone before sharing a build. Confirm that backup:

- starts only after setup and continues while the app is backgrounded and locked;
- pauses without Tailscale and resumes after it reconnects;
- reports insufficient storage and recovers through Try Again;
- targets only the selected Umbrel; and
- inventories a large library without memory termination while uploads make progress.
