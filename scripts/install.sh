#!/usr/bin/env bash
set -euo pipefail
umask 027

usage() {
  cat <<'EOF'
usage: install.sh install|upgrade ARTIFACT
       install.sh rollback
       install.sh reset --confirm-reset

Environment: WOT_ROOT, WOT_SKIP_HOST_INTEGRATION, PI_DISPLAY_INSTALL_PREFIX,
PI_DISPLAY_STATE_DIRECTORY, PI_DISPLAY_CONFIG_DIRECTORY, PI_DISPLAY_SERVICE_USER,
PI_DISPLAY_SERVICE_GROUP, PI_DISPLAY_NODE_EXECUTABLE, PI_DISPLAY_RELEASE_ID,
PI_DISPLAY_PUBLIC_HOST, PI_DISPLAY_DEVICE_NAME, PI_DISPLAY_PUBLIC_PORT.
EOF
}

action="${1:-}"
artifact="${2:-}"
case "$action" in
  install|upgrade) [[ -n "$artifact" ]] || { usage >&2; exit 2; } ;;
  rollback) ;;
  reset) [[ "$artifact" == "--confirm-reset" ]] || { usage >&2; exit 2; } ;;
  --help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

root_prefix="${WOT_ROOT:-}"
skip_host_integration="${WOT_SKIP_HOST_INTEGRATION:-false}"
install_prefix="${PI_DISPLAY_INSTALL_PREFIX:-/opt/pi-display-wot}"
state_directory="${PI_DISPLAY_STATE_DIRECTORY:-/var/lib/pi-display-wot}"
config_directory="${PI_DISPLAY_CONFIG_DIRECTORY:-/etc/pi-display-wot}"
service_user="${PI_DISPLAY_SERVICE_USER:-pi-display-wot}"
service_group="${PI_DISPLAY_SERVICE_GROUP:-pi-display-wot}"
node_executable="${PI_DISPLAY_NODE_EXECUTABLE:-/usr/bin/node}"
public_host="${PI_DISPLAY_PUBLIC_HOST:-$(hostname -f)}"
device_name="${PI_DISPLAY_DEVICE_NAME:-Pi Display Sink}"
public_port="${PI_DISPLAY_PUBLIC_PORT:-443}"

physical() { printf '%s%s' "$root_prefix" "$1"; }
install_root="$(physical "$install_prefix")"
state_root="$(physical "$state_directory")"
config_root="$(physical "$config_directory")"

[[ "$skip_host_integration" == "true" || "$(id -u)" == "0" ]] || {
  echo "install.sh must run as root" >&2
  exit 1
}
[[ "$public_host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo "invalid public host" >&2; exit 2; }
[[ "$device_name" =~ ^[A-Za-z0-9._[:space:]-]+$ ]] || { echo "invalid device name" >&2; exit 2; }
[[ "$public_port" =~ ^[0-9]+$ ]] && (( public_port >= 1 && public_port <= 65535 )) || {
  echo "invalid public port" >&2
  exit 2
}
public_origin="https://$public_host"
if [[ "$public_port" != "443" ]]; then
  public_origin="$public_origin:$public_port"
fi

escape_sed() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
render() {
  local source="$1" destination="$2"
  shift 2
  local expression=() key value
  while (( $# > 0 )); do
    key="$1"; value="$(escape_sed "$2")"; shift 2
    expression+=( -e "s|@$key@|$value|g" )
  done
  install -d -m 0755 "$(dirname "$destination")"
  sed "${expression[@]}" "$source" > "$destination"
  chmod 0644 "$destination"
}

ensure_account() {
  if [[ "$skip_host_integration" == "true" ]]; then
    if ! id "$service_user" >/dev/null 2>&1 || ! getent group "$service_group" >/dev/null; then
      service_user="$(id -un)"
      service_group="$(id -gn)"
    fi
    return
  fi
  getent group "$service_group" >/dev/null || groupadd --system "$service_group"
  id "$service_user" >/dev/null 2>&1 || useradd --system --gid "$service_group" \
    --home-dir "$state_directory" --shell /usr/sbin/nologin "$service_user"
}

configure_host() {
  local release_directory="$1"
  local systemd_unit="$(physical /etc/systemd/system/pi-display-wot.service)"
  local tmpfiles_config="$(physical /etc/tmpfiles.d/pi-display-wot.conf)"
  local avahi_service="$(physical /etc/avahi/services/pi-display-wot.service)"
  local nginx_config="$(physical /etc/nginx/conf.d/pi-display-wot.conf)"

  render "$release_directory/deploy/systemd/pi-display-wot.service" "$systemd_unit" \
    SERVICE_USER "$service_user" SERVICE_GROUP "$service_group" \
    INSTALL_PREFIX "$install_prefix" CONFIG_DIRECTORY "$config_directory" \
    STATE_DIRECTORY "$state_directory" NODE_EXECUTABLE "$node_executable"
  render "$release_directory/deploy/tmpfiles/pi-display-wot.conf" "$tmpfiles_config" \
    SERVICE_USER "$service_user" SERVICE_GROUP "$service_group" \
    CONFIG_DIRECTORY "$config_directory" STATE_DIRECTORY "$state_directory"
  render "$release_directory/deploy/avahi/pi-display-wot.service" "$avahi_service" \
    DEVICE_NAME "$device_name" HOST "$public_host" PORT "$public_port"
  render "$release_directory/deploy/nginx/pi-display-wot.conf" "$nginx_config" \
    BIND_ADDRESS "0.0.0.0" PORT "$public_port" TLS_SERVER_NAME "$public_host" \
    TLS_CERT_PATH "$config_directory/device.crt" TLS_KEY_PATH "$config_directory/device.key"

  if [[ "$skip_host_integration" != "true" ]]; then
    systemd-tmpfiles --create "$tmpfiles_config"
    nginx -t
    systemctl daemon-reload
    systemctl enable pi-display-wot.service
    systemctl restart nginx avahi-daemon pi-display-wot.service
  fi
}

activate_release() {
  local release_directory="$1"
  local current_target=""
  if [[ -L "$install_root/current" ]]; then
    current_target="$(readlink "$install_root/current")"
  fi
  ln -s "$release_directory" "$install_root/current.next"
  mv -Tf "$install_root/current.next" "$install_root/current"
  if [[ -n "$current_target" && "$current_target" != "$release_directory" ]]; then
    ln -sfn "$current_target" "$install_root/previous"
  fi
}

install_release() {
  [[ -f "$artifact" ]] || { echo "artifact not found: $artifact" >&2; exit 1; }
  while IFS= read -r member; do
    [[ "$member" != /* && "$member" != *"../"* && "$member" != ".." ]] || {
      echo "artifact contains an unsafe path: $member" >&2
      exit 1
    }
  done < <(tar -tzf "$artifact")

  ensure_account
  install -d -m 0755 "$install_root/releases"
  local release_id="${PI_DISPLAY_RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
  [[ "$release_id" =~ ^[0-9A-Za-z._-]+$ ]] || { echo "invalid release ID" >&2; exit 2; }
  local release_directory="$install_root/releases/$release_id"
  [[ ! -e "$release_directory" ]] || { echo "release already exists: $release_id" >&2; exit 1; }
  local staging_directory
  staging_directory="$(mktemp -d "$install_root/releases/.staging.XXXXXX")"
  trap 'rm -rf "$staging_directory"' EXIT
  tar -xzf "$artifact" -C "$staging_directory"
  for required in package.json dist/main.js node_modules deploy scripts/generate-device-identity.sh; do
    [[ -e "$staging_directory/$required" ]] || { echo "artifact is missing $required" >&2; exit 1; }
  done
  mv "$staging_directory" "$release_directory"
  trap - EXIT
  chown -R root:root "$release_directory" 2>/dev/null || true
  chmod +x "$release_directory/scripts/generate-device-identity.sh" \
    "$release_directory/scripts/smoke-test.sh"

  STATE_DIR="$state_root" SECRET_DIR="$config_root" \
    SERVICE_USER="$service_user" SERVICE_GROUP="$service_group" \
    DEVICE_HOSTNAME="$public_host" ADVERTISED_BASE_URL="$public_origin" \
    CORS_ALLOWED_ORIGINS="$public_origin" \
    "$release_directory/scripts/generate-device-identity.sh" provision
  activate_release "$release_directory"
  configure_host "$release_directory"
  printf 'activated_release=%s\n' "$release_id"
}

case "$action" in
  install|upgrade)
    install_release
    ;;
  rollback)
    [[ -L "$install_root/previous" ]] || { echo "no previous release is available" >&2; exit 1; }
    rollback_target="$(readlink "$install_root/previous")"
    [[ -d "$rollback_target" ]] || { echo "previous release is missing" >&2; exit 1; }
    current_target="$(readlink "$install_root/current")"
    ln -sfn "$current_target" "$install_root/previous"
    ln -s "$rollback_target" "$install_root/current.next"
    mv -Tf "$install_root/current.next" "$install_root/current"
    [[ "$skip_host_integration" == "true" ]] || systemctl restart pi-display-wot.service
    printf 'activated_release=%s\n' "$(basename "$rollback_target")"
    ;;
  reset)
    [[ -L "$install_root/current" ]] || { echo "no installed release is available" >&2; exit 1; }
    STATE_DIR="$state_root" SECRET_DIR="$config_root" \
      SERVICE_USER="$service_user" SERVICE_GROUP="$service_group" \
      DEVICE_HOSTNAME="$public_host" ADVERTISED_BASE_URL="$public_origin" \
      CORS_ALLOWED_ORIGINS="$public_origin" \
      "$install_root/current/scripts/generate-device-identity.sh" reset --confirm-reset
    [[ "$skip_host_integration" == "true" ]] || systemctl restart nginx avahi-daemon pi-display-wot.service
    ;;
esac