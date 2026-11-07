#!/bin/sh
# cloudflare-ddns client installer for Linux (systemd) and macOS (launchd).
#
#   curl -fsSL __DDNS_SERVER_URL__/install.sh | sudo sh
#   curl -fsSL __DDNS_SERVER_URL__/install.sh | sudo sh -s -- uninstall
#
# No questions are asked: the machine registers itself and shows up in the
# dashboard as a pending client. Running it again upgrades/repairs the install.
set -eu

SERVER="${DDNS_SERVER:-__DDNS_SERVER_URL__}"
ACTION="${1:-install}"
NAME="ddns-client"
BIN="/usr/local/bin/$NAME"
UNIT="/etc/systemd/system/$NAME.service"
PLIST_LABEL="com.cloudflare-ddns.client"
PLIST="/Library/LaunchDaemons/$PLIST_LABEL.plist"

log() { printf '%s\n' "ddns: $*"; }
die() { printf '%s\n' "ddns: error: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root, e.g. curl -fsSL $SERVER/install.sh | sudo sh"
command -v curl >/dev/null 2>&1 || die "curl is required"

OS="$(uname -s)"
case "$OS" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) die "unsupported OS: $OS (use install.ps1 on Windows)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  armv7* | armv6*) ARCH=arm ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

if [ "$OS" = darwin ]; then
  CONFIG_DIR="/Library/Application Support/$NAME"
else
  CONFIG_DIR="/etc/$NAME"
fi

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

stop_service() {
  if [ "${DDNS_NO_SERVICE:-}" = 1 ]; then return 0; fi
  if [ "$OS" = linux ]; then
    if command -v systemctl >/dev/null 2>&1 && [ -f "$UNIT" ]; then
      systemctl disable --now "$NAME" >/dev/null 2>&1 || true
    fi
  else
    launchctl bootout system "$PLIST" >/dev/null 2>&1 || true
  fi
}

uninstall() {
  stop_service
  rm -f "$UNIT" "$PLIST" "$BIN" "$BIN.old"
  if [ "${DDNS_NO_SERVICE:-}" != 1 ] && [ "$OS" = linux ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
  fi
  rm -rf "$CONFIG_DIR"
  log "uninstalled. Delete the client in the dashboard to remove it there too."
}

download() {
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  asset="${NAME}_${OS}_${ARCH}"
  log "downloading $asset"
  curl -fsSL -D "$tmp/headers" -o "$tmp/$asset" "$SERVER/download/latest/$asset" \
    || die "download failed: $SERVER/download/latest/$asset"
  version="$(sed -n 's/^[Xx]-[Rr]elease-[Vv]ersion: *\([^[:space:]]*\).*/\1/p' "$tmp/headers" | tail -n1)"
  [ -n "$version" ] || die "server did not report the release version"
  curl -fsSL -o "$tmp/checksums.txt" "$SERVER/download/$version/checksums.txt" || die "could not fetch checksums"
  want="$(awk -v a="$asset" '$2 == a || $2 == "*"a { print $1 }' "$tmp/checksums.txt")"
  got="$(sha256 "$tmp/$asset")"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "checksum mismatch for $asset"
  mkdir -p "$(dirname "$BIN")"
  install -m 0755 "$tmp/$asset" "$BIN.tmp"
  mv -f "$BIN.tmp" "$BIN"
  log "installed $NAME $version to $BIN"
}

install_systemd() {
  command -v systemctl >/dev/null 2>&1 || die "systemd is required on Linux"
  cat >"$UNIT" <<UNIT
[Unit]
Description=Cloudflare DDNS client
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=$BIN --server $SERVER
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable "$NAME" >/dev/null 2>&1
  systemctl restart "$NAME"
  log "service started (logs: journalctl -u $NAME -f)"
}

install_launchd() {
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BIN</string><string>--server</string><string>$SERVER</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/$NAME.log</string>
  <key>StandardErrorPath</key><string>/var/log/$NAME.log</string>
</dict>
</plist>
PLIST
  chmod 0644 "$PLIST"
  launchctl bootout system "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap system "$PLIST"
  log "service started (logs: tail -f /var/log/$NAME.log)"
}

case "$ACTION" in
  install)
    stop_service
    download
    if [ "${DDNS_NO_SERVICE:-}" = 1 ]; then
      log "DDNS_NO_SERVICE=1: skipping service setup"
    elif [ "$OS" = linux ]; then
      install_systemd
    else
      install_launchd
    fi
    log "done. Approve this machine in the dashboard: $SERVER"
    ;;
  uninstall) uninstall ;;
  *) die "unknown action: $ACTION (use install or uninstall)" ;;
esac
