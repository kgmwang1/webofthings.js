#!/usr/bin/env bash
set -euo pipefail

purge_state=false
if [[ "${1:-}" == "--purge-state" ]]; then
  [[ "${2:-}" == "--confirm-reset" ]] || {
    echo "--purge-state destroys identity and credentials; pass --confirm-reset" >&2
    exit 2
  }
  purge_state=true
elif [[ $# -ne 0 ]]; then
  echo "usage: uninstall.sh [--purge-state --confirm-reset]" >&2
  exit 2
fi

root_prefix="${WOT_ROOT:-}"
skip_host_integration="${WOT_SKIP_HOST_INTEGRATION:-false}"
install_prefix="${PI_DISPLAY_INSTALL_PREFIX:-/opt/pi-display-wot}"
state_directory="${PI_DISPLAY_STATE_DIRECTORY:-/var/lib/pi-display-wot}"
config_directory="${PI_DISPLAY_CONFIG_DIRECTORY:-/etc/pi-display-wot}"
physical() { printf '%s%s' "$root_prefix" "$1"; }

[[ "$skip_host_integration" == "true" || "$(id -u)" == "0" ]] || {
  echo "uninstall.sh must run as root" >&2
  exit 1
}

if [[ "$skip_host_integration" != "true" ]]; then
  systemctl disable --now pi-display-wot.service 2>/dev/null || true
fi
rm -rf "$(physical "$install_prefix")"
rm -f "$(physical /etc/systemd/system/pi-display-wot.service)" \
  "$(physical /etc/tmpfiles.d/pi-display-wot.conf)" \
  "$(physical /etc/avahi/services/pi-display-wot.service)" \
  "$(physical /etc/nginx/conf.d/pi-display-wot.conf)"

if [[ "$purge_state" == "true" ]]; then
  rm -rf "$(physical "$state_directory")" "$(physical "$config_directory")"
  echo "application, identity, and configuration removed"
else
  echo "application removed; identity and configuration retained"
fi

if [[ "$skip_host_integration" != "true" ]]; then
  systemctl daemon-reload
  systemctl restart nginx avahi-daemon
fi