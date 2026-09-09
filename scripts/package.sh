#!/usr/bin/env bash
set -euo pipefail
umask 022

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${1:-$repository_root/artifacts}"
version="$(node -p "require('$repository_root/package.json').version")"
artifact_name="pi-display-wot-${version}-linux-arm64.tar.gz"
work_directory="$(mktemp -d)"
trap 'rm -rf "$work_directory"' EXIT

[[ "$version" =~ ^[0-9A-Za-z._-]+$ ]] || { echo "package version contains unsupported characters" >&2; exit 2; }
mkdir -p "$output_directory" "$work_directory/package"

cp "$repository_root/package.json" "$repository_root/package-lock.json" \
  "$repository_root/tsconfig.json" "$work_directory/package/"
cp -R "$repository_root/src" "$repository_root/deploy" "$work_directory/package/"
mkdir -p "$work_directory/package/scripts"
cp "$repository_root/scripts/generate-device-identity.sh" \
  "$repository_root/scripts/smoke-test.sh" \
  "$work_directory/package/scripts/"

(
  cd "$work_directory/package"
  npm ci >&2
  npm run build >&2
  npm prune --omit=dev >&2
  rm -rf src tsconfig.json
)

tar -C "$work_directory/package" -czf "$output_directory/$artifact_name" .
printf '%s\n' "$output_directory/$artifact_name"