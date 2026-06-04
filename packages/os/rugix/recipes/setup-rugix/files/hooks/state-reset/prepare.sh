#!/bin/bash

# Rugix `state-reset/prepare` hook to reset the config and main disk data partition.
#
# Rugix calls this before a normal state reset so RAID config does not survive on the
# config partition. umbreld also calls this directly for factory resets while the
# active data mount is a RAID dataset. In that case Rugix must not reset state,
# because that would move/reset the RAID-backed install we need onboarding recovery
# to find. Calling only this hook clears the boot/config state and wipes the boot
# disk data partition while leaving the RAID pool untouched.

set -euo pipefail

CONFIG_PARTITION=${CONFIG_PARTITION:-"/run/rugix/mounts/config"}
CONFIG_FILE="$CONFIG_PARTITION/umbrel.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "[INFO] no config state file detected, nothing to do"
    exit 0
fi

# Parse YAML config to get devices array if config file exists
DEVICES=()
mapfile -t DEVICES < <(yq '.raid.devices[]' "$CONFIG_FILE" 2>/dev/null || true)

echo ">>> Removing RAID configuration from config partition"
if mountpoint -q "$CONFIG_PARTITION"; then
    # We need to remove the write-protection on the config partition.
    cleanup() {
        mount -o remount,ro "$CONFIG_PARTITION"
    }
    trap cleanup EXIT
    mount -o remount,rw "$CONFIG_PARTITION"
fi
rm -f "$CONFIG_FILE"

# If no RAID configuration is detected, nothing to do.
if [ ${#DEVICES[@]} -eq 0 ]; then
    echo "[INFO] no RAID configuration detected, nothing to do"
    exit 0
fi

# If we have a RAID configuration, we need to reformat the main disk data partition.

SYSTEM_INFO=$(rugix-ctrl system info)
BOOT_FLOW=$(echo "$SYSTEM_INFO" | jq -r ".boot.bootFlow")

# Determine the main disk data partition.
if [ "$BOOT_FLOW" == "mender-grub" ]; then
    # On Mender legacy devices, the data partition is the 4th partition on the main disk.
    MAIN_DATA_PARTITION=$(rugix-ctrl utils resolve-partition 4 | jq -r ".device" || true)
else
    # On Rugix-native devices the main disk data partition is the last partition on the
    # main disk, which is either the 7th (MBR) or the 6h (GPT) partition.
    for partition in 7 6; do
        MAIN_DATA_PARTITION=$(rugix-ctrl utils resolve-partition $partition 2>/dev/null | jq -r ".device" || true)
        if [ ! -z "${MAIN_DATA_PARTITION}" ]; then
            break
        fi
    done
fi
if [ -z "${MAIN_DATA_PARTITION}" ]; then
    echo "[ERROR] unable to determine main data partition"
    exit 1
fi

echo "[INFO] found main disk data partition: '$MAIN_DATA_PARTITION'"

# Ensure that the main disk data partition has not been mounted.
if [ ! -z $(lsblk -no MOUNTPOINT "$MAIN_DATA_PARTITION") ]; then
    echo "[ERROR] main disk data partition appears to be mounted"
    exit 1
fi

# At this point, we can either reformat the data partition or remove any state on it.
# Reformatting gives us a clean slate, so let's do that.
#
# We use -m 0.5 to reserve 0.5% of blocks for root-only writes (matching bootstrapping config).
mkfs.ext4 -F -m 0.5 -L data "$MAIN_DATA_PARTITION"
