#!/usr/bin/env bash
# Cloud-init user-data: prepare a bare Ubuntu 24.04 host to run the stack.
#
# Base setup only, on purpose. No secrets and no deploy key are placed here:
# user-data is readable from the instance metadata and through
# ec2:DescribeInstanceAttribute, so anything written here is not private.
# Credentials arrive afterwards over SSH.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
ROOT=/srv/agenticchess
APP_USER=ubuntu

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg openssl unattended-upgrades

# --- Docker from the official repository (the distro package lags behind and
# ships no compose v2 plugin) ---
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$APP_USER"

# --- Swap. 4 GB of RAM is enough to run the stack but tight while tsc and the
# image build run at the same time; 2 GB of swap turns a possible OOM kill into
# a slow build. ---
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

# --- Unattended security updates ---
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now unattended-upgrades

mkdir -p "$ROOT"
chown "$APP_USER:$APP_USER" "$ROOT"

touch /var/lib/agenticchess-provisioned
echo "provisioned"
