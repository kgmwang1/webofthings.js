#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact="${1:-}"
work_directory="$(mktemp -d)"
trap 'rm -rf "$work_directory"' EXIT
chmod 0755 "$work_directory"

if [[ -z "$artifact" ]]; then
  artifact="$(bash "$repository_root/scripts/package.sh" "$work_directory/artifacts")"
fi
artifact="$(cd "$(dirname "$artifact")" && pwd)/$(basename "$artifact")"

export WOT_ROOT="$work_directory/root"
export WOT_SKIP_HOST_INTEGRATION=true
export PI_DISPLAY_PUBLIC_HOST=display.test
export PI_DISPLAY_SERVICE_USER="${PI_DISPLAY_SERVICE_USER:-pi-display-wot}"
export PI_DISPLAY_SERVICE_GROUP="${PI_DISPLAY_SERVICE_GROUP:-pi-display-wot}"
mkdir -p "$WOT_ROOT"

PI_DISPLAY_RELEASE_ID=release-1 bash "$repository_root/scripts/install.sh" install "$artifact"
thing_id_file="$WOT_ROOT/var/lib/pi-display-wot/thing-id"
environment_file="$WOT_ROOT/etc/pi-display-wot/runtime.env"
first_identity="$(sha256sum "$thing_id_file" "$environment_file")"

PI_DISPLAY_RELEASE_ID=release-2 bash "$repository_root/scripts/install.sh" upgrade "$artifact"
second_identity="$(sha256sum "$thing_id_file" "$environment_file")"
[[ "$first_identity" == "$second_identity" ]]
[[ "$(basename "$(readlink "$WOT_ROOT/opt/pi-display-wot/current")")" == "release-2" ]]

bash "$repository_root/scripts/install.sh" rollback
third_identity="$(sha256sum "$thing_id_file" "$environment_file")"
[[ "$first_identity" == "$third_identity" ]]
[[ "$(basename "$(readlink "$WOT_ROOT/opt/pi-display-wot/current")")" == "release-1" ]]

grep -R '@[A-Z_][A-Z_]*@' \
  "$WOT_ROOT/etc/systemd/system/pi-display-wot.service" \
  "$WOT_ROOT/etc/tmpfiles.d/pi-display-wot.conf" \
  "$WOT_ROOT/etc/avahi/services/pi-display-wot.service" \
  "$WOT_ROOT/etc/nginx/conf.d/pi-display-wot.conf" && {
    echo "rendered deployment files contain unresolved placeholders" >&2
    exit 1
  }

[[ "$(stat -c '%a' "$WOT_ROOT/var/lib/pi-display-wot")" == "750" ]]
[[ "$(stat -c '%U:%G' "$WOT_ROOT/var/lib/pi-display-wot")" == "$PI_DISPLAY_SERVICE_USER:$PI_DISPLAY_SERVICE_GROUP" ]]
[[ "$(stat -c '%a' "$thing_id_file")" == "644" ]]
[[ "$(stat -c '%U:%G' "$thing_id_file")" == "$PI_DISPLAY_SERVICE_USER:$PI_DISPLAY_SERVICE_GROUP" ]]
[[ "$(stat -c '%a' "$WOT_ROOT/etc/pi-display-wot")" == "750" ]]
[[ "$(stat -c '%U:%G' "$WOT_ROOT/etc/pi-display-wot")" == "root:$PI_DISPLAY_SERVICE_GROUP" ]]
[[ "$(stat -c '%a' "$environment_file")" == "640" ]]
[[ "$(stat -c '%U:%G' "$environment_file")" == "$PI_DISPLAY_SERVICE_USER:$PI_DISPLAY_SERVICE_GROUP" ]]
[[ "$(stat -c '%a' "$WOT_ROOT/etc/pi-display-wot/device.key")" == "640" ]]
[[ "$(stat -c '%a' "$WOT_ROOT/etc/pi-display-wot/device.crt")" == "644" ]]

run_runtime() {
  local log_file="$work_directory/runtime.log"
  local pid_file="$work_directory/runtime.pid"
  : > "$log_file"
  setpriv --reuid="$PI_DISPLAY_SERVICE_USER" --regid="$PI_DISPLAY_SERVICE_GROUP" \
    --init-groups bash -c \
    "set -a; source '$environment_file'; set +a; exec node '$WOT_ROOT/opt/pi-display-wot/current/dist/main.js'" \
    >"$log_file" 2>&1 &
  echo "$!" > "$pid_file"
  for _ in {1..30}; do
    grep -q 'Runtime started' "$log_file" && return 0
    kill -0 "$(cat "$pid_file")" 2>/dev/null || { cat "$log_file" >&2; return 1; }
    sleep 1
  done
  cat "$log_file" >&2
  return 1
}

run_runtime
runtime_pid="$(cat "$work_directory/runtime.pid")"
[[ "$(ps -o user= -p "$runtime_pid" | xargs)" == "$PI_DISPLAY_SERVICE_USER" ]]
kill -KILL "$runtime_pid"
wait "$runtime_pid" 2>/dev/null || true
run_runtime
runtime_pid="$(cat "$work_directory/runtime.pid")"
kill -TERM "$runtime_pid"
wait "$runtime_pid"
[[ "$(sha256sum "$thing_id_file" "$environment_file")" == "$first_identity" ]]

bash "$repository_root/scripts/uninstall.sh"
[[ -f "$thing_id_file" && -f "$environment_file" ]]
bash "$repository_root/scripts/uninstall.sh" --purge-state --confirm-reset
[[ ! -e "$thing_id_file" && ! -e "$environment_file" ]]

echo "package_lifecycle=pass"
echo "identity_preserved_across_upgrade_rollback=true"
echo "native_permission_attestation=pass"
echo "non_root_runtime=pass"
echo "crash_restart_simulation=pass"