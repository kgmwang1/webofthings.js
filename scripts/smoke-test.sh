#!/usr/bin/env bash
set -euo pipefail

expected_model=""
exercise_recovery=false
while (( $# > 0 )); do
  case "$1" in
    --expected-model) expected_model="${2:-}"; shift 2 ;;
    --exercise-recovery) exercise_recovery=true; shift ;;
    --help)
      echo "usage: smoke-test.sh [--expected-model pi4|pi5] [--exercise-recovery]"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

config_directory="${PI_DISPLAY_CONFIG_DIRECTORY:-/etc/pi-display-wot}"
state_directory="${PI_DISPLAY_STATE_DIRECTORY:-/var/lib/pi-display-wot}"
environment_file="$config_directory/runtime.env"
thing_id_file="$state_directory/thing-id"

[[ "$(id -u)" == "0" ]] || { echo "smoke-test.sh must run as root" >&2; exit 1; }
for command in curl nginx systemctl stat sha256sum; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done

if [[ -n "$expected_model" ]]; then
  model="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
  case "$expected_model" in
    pi4) [[ "$model" == *"Raspberry Pi 4"* ]] ;;
    pi5) [[ "$model" == *"Raspberry Pi 5"* ]] ;;
    *) echo "expected model must be pi4 or pi5" >&2; exit 2 ;;
  esac || { echo "hardware model mismatch: $model" >&2; exit 1; }
fi

[[ "$(stat -c '%a:%U:%G' "$state_directory")" == "750:pi-display-wot:pi-display-wot" ]]
[[ "$(stat -c '%a:%U:%G' "$thing_id_file")" == "644:pi-display-wot:pi-display-wot" ]]
[[ "$(stat -c '%a:%U:%G' "$config_directory")" == "750:root:pi-display-wot" ]]
[[ "$(stat -c '%a:%U:%G' "$environment_file")" == "640:pi-display-wot:pi-display-wot" ]]
[[ "$(stat -c '%a:%U:%G' "$config_directory/device.key")" == "640:pi-display-wot:pi-display-wot" ]]
[[ "$(stat -c '%a:%U:%G' "$config_directory/device.crt")" == "644:pi-display-wot:pi-display-wot" ]]

value() { sed -n "s/^$1=//p" "$environment_file"; }
base_url="$(value PI_DISPLAY_ADVERTISED_BASE_URL)"
username="$(value PI_DISPLAY_USERNAME)"
password="$(value PI_DISPLAY_PASSWORD)"
certificate="$(value PI_DISPLAY_TLS_CERT_PATH)"
identity_before="$(sha256sum "$thing_id_file" "$environment_file")"

systemctl is-active --quiet pi-display-wot.service nginx avahi-daemon
[[ "$(systemctl show -p User --value pi-display-wot.service)" == "pi-display-wot" ]]
curl --fail --silent --show-error --cacert "$certificate" \
  --user "$username:$password" "$base_url/pidisplaysink" >/dev/null
nginx -t
grep -q '<type>_wot._tcp</type>' /etc/avahi/services/pi-display-wot.service

if [[ "$exercise_recovery" == "true" ]]; then
  main_pid="$(systemctl show -p MainPID --value pi-display-wot.service)"
  kill -KILL "$main_pid"
  for _ in {1..30}; do
    systemctl is-active --quiet pi-display-wot.service && break
    sleep 1
  done
  systemctl is-active --quiet pi-display-wot.service

  started_at="$SECONDS"
  systemctl stop pi-display-wot.service
  (( SECONDS - started_at <= 20 ))
  [[ "$(systemctl show -p ControlGroup --value pi-display-wot.service)" == "" ]]
  systemctl start pi-display-wot.service
fi

identity_after="$(sha256sum "$thing_id_file" "$environment_file")"
[[ "$identity_before" == "$identity_after" ]]
echo "appliance_smoke=pass"
echo "identity_sha256=$(sha256sum "$thing_id_file" | cut -d' ' -f1)"
echo "service_restarts=$(systemctl show -p NRestarts --value pi-display-wot.service)"