#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
model="${2:-}"
power_cycles="${POWER_CYCLES:-5}"
soak_seconds="${SOAK_SECONDS:-86400}"
sample_seconds="${SAMPLE_SECONDS:-60}"
[[ -n "$target" && "$model" =~ ^pi[45]$ ]] || {
  echo "usage: appliance-test.sh SSH_TARGET pi4|pi5" >&2
  exit 2
}
[[ -n "${POWER_CYCLE_COMMAND:-}" ]] || {
  echo "POWER_CYCLE_COMMAND must name a controller command that accepts the SSH target" >&2
  exit 2
}
[[ -n "${DHCP_CHANGE_COMMAND:-}" ]] || {
  echo "DHCP_CHANGE_COMMAND must renew or change the lease and print the updated SSH target" >&2
  exit 2
}

remote_smoke() {
  ssh "$target" "sudo /opt/pi-display-wot/current/scripts/smoke-test.sh --expected-model '$model' $1"
}
wait_for_ssh() {
  local expected="$1"
  for _ in {1..180}; do
    if ssh -o BatchMode=yes -o ConnectTimeout=2 "$target" true 2>/dev/null; then
      [[ "$expected" == "up" ]] && return 0
    else
      [[ "$expected" == "down" ]] && return 0
    fi
    sleep 2
  done
  echo "timed out waiting for $target to be $expected" >&2
  return 1
}

baseline="$(remote_smoke --exercise-recovery | tee /dev/stderr | sed -n 's/^identity_sha256=//p')"
for (( cycle=1; cycle<=power_cycles; cycle++ )); do
  "$POWER_CYCLE_COMMAND" "$target"
  wait_for_ssh down
  wait_for_ssh up
  current="$(remote_smoke '' | tee /dev/stderr | sed -n 's/^identity_sha256=//p')"
  [[ "$current" == "$baseline" ]] || { echo "identity changed after power cycle $cycle" >&2; exit 1; }
  echo "power_cycle_${cycle}=pass"
done

updated_target="$("$DHCP_CHANGE_COMMAND" "$target")"
[[ -n "$updated_target" ]] || { echo "DHCP controller returned no updated target" >&2; exit 1; }
target="$updated_target"
wait_for_ssh up
current="$(remote_smoke '' | tee /dev/stderr | sed -n 's/^identity_sha256=//p')"
[[ "$current" == "$baseline" ]] || { echo "identity changed after DHCP lease change" >&2; exit 1; }
echo "dhcp_change=pass"

deadline=$(( SECONDS + soak_seconds ))
while (( SECONDS < deadline )); do
  current="$(remote_smoke '' | tee /dev/stderr | sed -n 's/^identity_sha256=//p')"
  [[ "$current" == "$baseline" ]] || { echo "identity changed during soak" >&2; exit 1; }
  ssh "$target" "systemctl show pi-display-wot.service -p NRestarts -p MainPID; ps -o pid,ppid,%cpu,rss,etime -p \$(systemctl show -p MainPID --value pi-display-wot.service)"
  sleep "$sample_seconds"
done
echo "soak_seconds=$soak_seconds"
echo "appliance_gate=pass"