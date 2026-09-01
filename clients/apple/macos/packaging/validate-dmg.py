#!/usr/bin/env python3
"""Validate the installable contents and Finder presentation of an Umbrel DMG."""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
import tempfile
from pathlib import Path

from ds_store import DSStore


def fail(message: str) -> None:
    raise RuntimeError(message)


def attach(image: Path, mount_root: Path) -> tuple[str, Path]:
    result = subprocess.run(
        [
            "/usr/bin/hdiutil",
            "attach",
            str(image),
            "-readonly",
            "-nobrowse",
            "-mountrandom",
            str(mount_root),
            "-plist",
        ],
        check=True,
        capture_output=True,
    )
    entities = plistlib.loads(result.stdout)["system-entities"]
    mounted = next((entity for entity in entities if "mount-point" in entity), None)
    if mounted is None:
        fail("hdiutil attached the image without mounting its volume")
    return mounted["dev-entry"], Path(mounted["mount-point"])


def require_path(path: Path) -> None:
    if not path.exists():
        fail(f"DMG is missing {path.name}")


def validate_layout(mount: Path) -> None:
    app = mount / "Umbrel.app"
    applications = mount / "Applications"
    # dmgbuild combines the 1x and 2x source images into this Retina TIFF.
    background = mount / ".background.tiff"
    volume_icon = mount / ".VolumeIcon.icns"
    ds_store_path = mount / ".DS_Store"

    for path in (app, background, volume_icon, ds_store_path):
        require_path(path)

    if not applications.is_symlink() or os.readlink(applications) != "/Applications":
        fail("DMG Applications item is not a /Applications symlink")

    subprocess.run(
        ["/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)],
        check=True,
    )

    # ds_store accepts a path string or an open file, but not pathlib.Path.
    with DSStore.open(str(ds_store_path), "r") as store:
        records = {(entry.filename, entry.code): entry.value for entry in store}

    window = records.get((".", b"bwsp"))
    icon_view = records.get((".", b"icvp"))
    if not isinstance(window, dict) or not isinstance(icon_view, dict):
        fail("DMG is missing Finder window or icon-view settings")

    expected_window = {
        "WindowBounds": "{{120, 120}, {660, 400}}",
        "ShowToolbar": False,
        "ShowStatusBar": False,
        "ShowPathbar": True,
        "ShowSidebar": False,
    }
    for key, expected in expected_window.items():
        if window.get(key) != expected:
            fail(f"Unexpected Finder window setting {key}: {window.get(key)!r}")

    expected_icon_view = {
        "backgroundType": 2,
        "arrangeBy": "none",
        "iconSize": 128.0,
        "textSize": 13.0,
    }
    for key, expected in expected_icon_view.items():
        if icon_view.get(key) != expected:
            fail(f"Unexpected Finder icon-view setting {key}: {icon_view.get(key)!r}")
    if not icon_view.get("backgroundImageAlias"):
        fail("DMG Finder settings do not reference the installer background")

    expected_locations = {
        "Umbrel.app": (190, 150),
        "Applications": (470, 150),
    }
    for item, expected in expected_locations.items():
        if records.get((item, b"Iloc")) != expected:
            fail(f"Unexpected Finder position for {item}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("Usage: validate-dmg.py <path-to-dmg>")

    image = Path(sys.argv[1]).resolve()
    if not image.is_file():
        fail(f"DMG not found: {image}")

    with tempfile.TemporaryDirectory(prefix="umbrel-dmg-validation.") as mount_root:
        device, mount = attach(image, Path(mount_root))
        try:
            validate_layout(mount)
        finally:
            subprocess.run(
                ["/usr/bin/hdiutil", "detach", device],
                check=True,
                capture_output=True,
            )

    print(f"Validated installer contents and Finder layout: {image}")


if __name__ == "__main__":
    main()
