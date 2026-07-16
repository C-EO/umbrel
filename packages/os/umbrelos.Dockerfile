ARG DEBIAN_VERSION=trixie
# Debian Docker image tags lag behind snapshot.debian.org, so pin the base image
# and apt repositories independently.
ARG DEBIAN_IMAGE_SNAPSHOT_DATE=20260421
ARG APT_SNAPSHOT_DATE=20260504
ARG BASE_VARIANT=""

ARG DOCKER_VERSION=28.5.0
ARG DOCKER_INSTALL_SCRIPT_COMMIT=5c8855edd778525564500337f5ac4ad65a0c168e

ARG YQ_VERSION=4.24.5
ARG YQ_SHA256_amd64=c93a696e13d3076e473c3a43c06fdb98fafd30dc2f43bc771c4917531961c760
ARG YQ_SHA256_arm64=8879e61c0b3b70908160535ea358ec67989ac4435435510e1fcb2eda5d74a0e9

ARG NODE_VERSION=22.13.0
ARG NODE_SHA256_amd64=9a33e89093a0d946c54781dcb3ccab4ccf7538a7135286528ca41ca055e9b38f  
ARG NODE_SHA256_arm64=e0cc088cb4fb2e945d3d5c416c601e1101a15f73e0f024c9529b964d9f6dce5b

ARG KOPIA_VERSION=0.19.0
ARG KOPIA_SHA256_amd64=c07843822c82ec752e5ee749774a18820b858215aabd7da448ce665b9b9107aa
ARG KOPIA_SHA256_arm64=632db9d72f2116f1758350bf7c20aa57c22c220480aaccb5f839e75669210ed9

#########################################################################
# ui build stage
#########################################################################

FROM node:${NODE_VERSION}-bookworm-slim AS ui-build

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY packages/ui/ .

# The ui-build stage only has 'packages/ui' in '/app', but the ui imports runtime values
# via a relative path ('../../../umbreld/source/modules/server/trpc/common') that resolves outside '/app'.
# We copy the target file to the expected path for the build to succeed.
COPY packages/umbreld/source/modules/server/trpc/common.ts /umbreld/source/modules/server/trpc/common.ts

# Install the dependencies
RUN rm -rf node_modules || true
RUN npm ci

# Build the app
RUN npm run build


#########################################################################
# umbrelos-base build stage (amd64 and generic arm64)
#########################################################################

FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS umbrelos-base

ARG APT_SNAPSHOT_DATE
ARG TARGETARCH

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

# Install Linux kernel, firmware, and ZFS
RUN apt-get install --yes \
    zfs-dkms \
    zfsutils-linux \
    linux-headers-${TARGETARCH} \
    linux-image-${TARGETARCH} \
    firmware-linux

# Install amd64-specific microcode and firmware
RUN if [ "${TARGETARCH}" = "amd64" ]; then \
    apt-get install --yes \
        intel-microcode \
        amd64-microcode \
        firmware-realtek \
        firmware-iwlwifi \
        firmware-atheros; \
    fi

# Cleanup build steps.
RUN rm -rf /build-steps


#########################################################################
# umbrelos-base-pi build stage (Raspberry Pi)
#########################################################################

FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS umbrelos-base-pi

ARG APT_SNAPSHOT_DATE

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

RUN /build-steps/setup-raspberrypi.sh

# Cleanup build steps.
RUN rm -rf /build-steps

# Copy Pi-specific filesystem overlay
COPY packages/os/overlay-pi /


#########################################################################
# watchman build stage (amd64 and arm64)
#########################################################################

# Nasty hack to work around a Parcel watcher bug:
# https://github.com/getumbrel/umbrel/issues/2158
#
# We install Watchman through Homebrew because it gives us prebuilt bottles
# for both arm64 and amd64. Building Watchman from source takes ages, and
# upstream only provides prebuilt binaries for amd64.
#
# This can be removed if Parcel fixes the watcher bug or if we move away from
# Parcel's watcher.
FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS watchman-build

ARG APT_SNAPSHOT_DATE
ARG WATCHMAN_VERSION=2026.05.11.00
ARG WATCHMAN_HOMEBREW_CORE_COMMIT=a33d7e6eed67d79d55b3d45050c6f45646116393

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

RUN apt-get install --yes ca-certificates curl git file patchelf procps

RUN useradd --create-home --shell /bin/bash linuxbrew && \
    mkdir -p /home/linuxbrew/.linuxbrew && \
    chown -R linuxbrew:linuxbrew /home/linuxbrew

USER linuxbrew

ENV HOME=/home/linuxbrew
ENV HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew
ENV HOMEBREW_CELLAR=/home/linuxbrew/.linuxbrew/Cellar
ENV HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew/Homebrew
ENV PATH=/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}
ENV HOMEBREW_NO_ANALYTICS=1
ENV HOMEBREW_NO_AUTO_UPDATE=1
ENV HOMEBREW_NO_ENV_HINTS=1
ENV HOMEBREW_NO_INSTALL_CLEANUP=1
ENV HOMEBREW_NO_INSTALL_FROM_API=1

RUN git clone --depth=1 https://github.com/Homebrew/brew "${HOMEBREW_REPOSITORY}" && \
    mkdir -p \
        "${HOMEBREW_PREFIX}/bin" \
        "${HOMEBREW_PREFIX}/etc" \
        "${HOMEBREW_PREFIX}/include" \
        "${HOMEBREW_PREFIX}/lib" \
        "${HOMEBREW_PREFIX}/opt" \
        "${HOMEBREW_PREFIX}/sbin" \
        "${HOMEBREW_PREFIX}/share" \
        "${HOMEBREW_PREFIX}/var/homebrew" && \
    ln -s ../Homebrew/bin/brew "${HOMEBREW_PREFIX}/bin/brew"

RUN mkdir -p "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" init && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" remote add origin https://github.com/Homebrew/homebrew-core.git && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" fetch --depth=1 origin "${WATCHMAN_HOMEBREW_CORE_COMMIT}" && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" checkout --detach FETCH_HEAD

RUN brew install --formula --force-bottle watchman && \
    test "$(watchman -v)" = "${WATCHMAN_VERSION}" && \
    brew cleanup --prune=all

USER root

RUN cp -a /home/linuxbrew/.linuxbrew /opt/linuxbrew && \
    grep -Z -a -r -l "/home/linuxbrew/.linuxbrew" /opt/linuxbrew | xargs -0 -r sh -c ' \
        for file do \
            if patchelf --print-interpreter "$file" >/dev/null 2>&1; then \
                patchelf --set-interpreter /opt/linuxbrew/lib/ld.so "$file"; \
            fi; \
            rpath="$(patchelf --print-rpath "$file" 2>/dev/null || true)"; \
            if printf "%s" "$rpath" | grep -q "/home/linuxbrew/.linuxbrew"; then \
                patchelf --set-rpath "$(printf "%s" "$rpath" | sed "s#/home/linuxbrew/.linuxbrew#/opt/linuxbrew#g")" "$file"; \
            fi; \
        done \
    ' sh && \
    mv /home/linuxbrew /home/linuxbrew.build-only && \
    /opt/linuxbrew/bin/watchman -v


#########################################################################
# umbrelos build stage
#########################################################################

# TODO: Instead of using the debian:trixie image as a base we should
# build a fresh rootfs from scratch. We can use the same tool the Docker
# images use for reproducible Debian builds: https://github.com/debuerreotype/debuerreotype
FROM umbrelos-base${BASE_VARIANT} AS umbrelos

# We need to duplicate this such that we can also use the argument below.
ARG TARGETARCH
ARG DOCKER_VERSION
ARG DOCKER_INSTALL_SCRIPT_COMMIT
ARG YQ_VERSION
ARG YQ_SHA256_amd64
ARG YQ_SHA256_arm64
ARG NODE_VERSION
ARG NODE_SHA256_amd64
ARG NODE_SHA256_arm64
ARG KOPIA_VERSION
ARG KOPIA_SHA256_amd64
ARG KOPIA_SHA256_arm64

# Install acpid
# We use acpid to implement custom behaviour for power button presses
RUN apt-get install --yes acpid
RUN systemctl enable acpid

# Install zram-generator for swap
RUN apt-get install --yes systemd-zram-generator

# Install essential networking services
RUN apt-get install --yes network-manager systemd-timesyncd openssh-server avahi-daemon avahi-discover avahi-utils libnss-mdns nftables

# Install bluetooth stack
# The default configuration enables all bluetooth controllers/adapters present on boot and plugged in after boot
RUN apt-get install --yes bluez

# Install essential system utilities
RUN apt-get install --yes sudo nano vim less man iproute2 iputils-ping curl wget ca-certificates usbutils whois build-essential e2fsprogs

# Install umbreld dependencies
# (many of these can be remove after the apps refactor)
RUN apt-get install --yes python3 fswatch jq rsync git gettext-base gnupg procps dmidecode unar imagemagick ffmpeg samba wsdd2 cifs-utils smbclient nvme-cli smartmontools pciutils

# Disable automatically starting smbd and wsdd2 at boot so umbreld can initialize them only when they're needed
RUN systemctl disable smbd wsdd2

# Filessystem support
RUN apt-get install --yes gdisk parted e2fsprogs exfatprogs
# For some reason this always fails on arm64 but it's ok since we
# don't support external storage on Pi anyway.
RUN [ "${TARGETARCH}" = "amd64" ] && apt-get install --yes ntfs-3g || true

# Install Node.js
RUN NODE_ARCH=$([ "${TARGETARCH}" = "arm64" ] && echo "arm64" || echo "x64") && \
    NODE_SHA256=$(eval echo \$NODE_SHA256_${TARGETARCH}) && \
    curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz -o node.tar.gz && \
    echo "${NODE_SHA256}  node.tar.gz" | sha256sum -c - && \
    tar -xz -f node.tar.gz -C /usr/local --strip-components=1 && \
    rm -rf node.tar.gz

# Install yq from binary
# Debian repos have kislyuk/yq but we want mikefarah/yq
RUN YQ_SHA256=$(eval echo \$YQ_SHA256_${TARGETARCH}) && \
    curl -L https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${TARGETARCH} -o /usr/bin/yq && \
    echo "${YQ_SHA256} /usr/bin/yq" | sha256sum -c && \
    chmod +x /usr/bin/yq

RUN curl -fsSL https://raw.githubusercontent.com/docker/docker-install/${DOCKER_INSTALL_SCRIPT_COMMIT}/install.sh -o /tmp/install-docker.sh
RUN sh /tmp/install-docker.sh --version v${DOCKER_VERSION}
RUN rm /tmp/install-docker.sh

# Install kopia from binary
RUN KOPIA_ARCH=$([ "${TARGETARCH}" = "arm64" ] && echo "arm64" || echo "x64") && \
    KOPIA_SHA256=$(eval echo \$KOPIA_SHA256_${TARGETARCH}) && \
    curl -L https://github.com/kopia/kopia/releases/download/v${KOPIA_VERSION}/kopia-${KOPIA_VERSION}-linux-${KOPIA_ARCH}.tar.gz -o /tmp/kopia.tar.gz && \
    echo "${KOPIA_SHA256} /tmp/kopia.tar.gz" | sha256sum -c && \
    tar -xz -f /tmp/kopia.tar.gz -C /tmp && \
    mv /tmp/kopia-${KOPIA_VERSION}-linux-${KOPIA_ARCH}/kopia /usr/bin/kopia && \
    chmod +x /usr/bin/kopia

# kopia also requires fuse3 for mounting snapshots
RUN apt-get install --yes fuse3 bindfs

# Install Watchman from pinned Homebrew bottles.
COPY --from=watchman-build --chown=root:root /opt/linuxbrew/ /opt/linuxbrew/
ENV PATH=/opt/linuxbrew/bin:/opt/linuxbrew/sbin:${PATH}
RUN ln -sf /opt/linuxbrew/bin/watchman /usr/local/bin/watchman && \
    ln -sf /opt/linuxbrew/bin/watchman /usr/bin/watchman && \
    mkdir -p /usr/local/var/run/watchman && \
    chmod 2777 /usr/local/var/run/watchman && \
    watchman -v

# Add Umbrel user
RUN adduser --gecos "" --disabled-password umbrel
RUN echo "umbrel:umbrel" | chpasswd
RUN usermod -aG sudo umbrel

# Preload images
RUN sudo apt-get install --yes skopeo
RUN mkdir -p /images
RUN skopeo copy docker://ghcr.io/getumbrel/tor@sha256:e382b8629c0dfef6ceb396b062622d4e4e955b19d6f16b883fd2c0723ad5671a docker-archive:/images/tor
RUN skopeo copy docker://getumbrel/auth-server@sha256:7fc9d52d4176639e84044b63aa07efcac78a508a05bb4480436be9db977a7191 docker-archive:/images/auth

# Install umbreld
COPY packages/umbreld /opt/umbreld
COPY --from=ui-build /app/dist /opt/umbreld/ui
WORKDIR /opt/umbreld
RUN rm -rf node_modules || true
RUN npm clean-install --omit dev && npm link
WORKDIR /

# TODO: Remove these bind-mount override files after publishing app-auth/app-proxy images with the LAN ingress changes.
RUN mkdir -p /opt/containers/app-auth/bin /opt/containers/app-auth/middleware /opt/containers/app-auth/routes /opt/containers/app-auth/utils /opt/containers/app-proxy/bin /opt/containers/app-proxy/routes /opt/containers/app-proxy/utils
COPY containers/app-auth/bin/www /opt/containers/app-auth/bin/www
COPY containers/app-auth/middleware/validate_token.js /opt/containers/app-auth/middleware/validate_token.js
COPY containers/app-auth/routes/auth.js /opt/containers/app-auth/routes/auth.js
COPY containers/app-auth/utils/const.js /opt/containers/app-auth/utils/const.js
COPY containers/app-auth/utils/host_resolution.js /opt/containers/app-auth/utils/host_resolution.js
COPY containers/app-proxy/bin/www /opt/containers/app-proxy/bin/www
COPY containers/app-proxy/routes/umbrel.js /opt/containers/app-proxy/routes/umbrel.js
COPY containers/app-proxy/utils/auth.js /opt/containers/app-proxy/utils/auth.js
COPY containers/app-proxy/utils/const.js /opt/containers/app-proxy/utils/const.js
COPY containers/app-proxy/utils/proxy.js /opt/containers/app-proxy/utils/proxy.js

# Copy in filesystem overlay
COPY packages/os/overlay /

# Rebuild initramfs after overlay changes so custom udev rules are available
# during early boot coldplug and /dev/disk/by-umbrel-id exists before the
# mount script runs.
RUN update-initramfs -u

# Move persistant locations to /data to be bind mounted over the OS.
# /data will exist on a seperate partition that survives OS updates.
# This step should always be last so things like /var/log/apt/
# exist while installing packages.
# Migrataing current data is required to not break journald, otherwise
# /var/log/journal will not exist and journald will log to RAM and not
# persist between reboots.
RUN mkdir -p /data/umbrel-os/var
RUN mv /var/log     /data/umbrel-os/var/log
RUN mv /home        /data/umbrel-os/home
