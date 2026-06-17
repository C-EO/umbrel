# umbrelOS USB Installer

A minimal NixOS based live ISO that flashes umbrelOS to a storage device. It
boots as a CD (VMs) or USB stick (hardware) on both BIOS and UEFI systems.

The live system runs from an immutable squashfs (with a tmpfs overlay for
runtime state) so the boot medium is never written to and can't be corrupted.
On boot the installer script (`custom-tty`) runs on tty1:

- Umbrel Home: automatically flashes the internal NVMe drive and shuts down.
- Umbrel Pro: automatically flashes the internal eMMC and shuts down.
- Everything else: interactive storage device selection.

## Build

The build runs Nix inside Docker so it works the same on macOS, Linux and CI.
It has two phases:

1. `./build.sh base` builds the installer ISO *without* an umbrelOS image
   (`build/umbrelos-amd64-usb-installer-base.iso`). This is the slow part and
   doesn't depend on the umbrelOS image, so CI runs it concurrently with the
   umbrelOS image builds.
2. `./build.sh inject` adds `build/umbrelos-amd64.img.xz` to the base ISO and
   re-masters it — giving the EFI image a standalone GPT EFI System Partition
   so it boots from USB on strict UEFI firmware — to produce the final
   `build/umbrelos-amd64-usb-installer.iso`. This is fast, so the umbrelOS
   image can be dropped in as the last step of a release build.

`./build.sh` with no arguments runs both phases. The umbrelOS image is read
from the boot medium at `/iso/umbrelos-amd64.img.xz` at runtime.

## Test

```bash
# CD-ROM boot (used by VMs)
qemu-system-x86_64 -machine accel=tcg -m 2048 -bios OVMF.fd -cdrom ../build/umbrelos-amd64-usb-installer.iso

# USB boot (used by physical machines)
qemu-system-x86_64 -machine accel=tcg -m 2048 -bios OVMF.fd -drive if=none,id=stick,format=raw,file=../build/umbrelos-amd64-usb-installer.iso -device nec-usb-xhci,id=xhci -device usb-storage,bus=xhci.0,drive=stick
```

Drop `-bios OVMF.fd` to test legacy BIOS boot instead of UEFI.
