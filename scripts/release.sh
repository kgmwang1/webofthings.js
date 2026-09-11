#!/usr/bin/env bash
set -euo pipefail
umask 022

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${1:-$repository_root/artifacts}"
version="$(cd "$repository_root" && node -p "require('./package.json').version")"
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git -C "$repository_root" log -1 --format=%ct)}"
revision="${RELEASE_REVISION:-$(git -C "$repository_root" rev-parse HEAD)}"
artifact_name="pi-display-wot-${version}-linux-arm64.tar.gz"
sbom_name="pi-display-wot-${version}.cdx.json"
dependencies_name="pi-display-wot-${version}-dependencies.json"
inputs_name="pi-display-wot-${version}-build-inputs.txt"
media_entry_name="pi-display-wot-${version}-media-entry.json"

[[ "$source_date_epoch" =~ ^[0-9]+$ ]] || { echo "SOURCE_DATE_EPOCH must be an integer" >&2; exit 2; }
rm -rf "$output_directory"
mkdir -p "$output_directory"

SOURCE_DATE_EPOCH="$source_date_epoch" bash "$repository_root/scripts/package.sh" "$output_directory" >/dev/null
node "$repository_root/scripts/generate-sbom.cjs" "$output_directory/$sbom_name" >/dev/null
npm ls --all --json > "$output_directory/$dependencies_name"
node "$repository_root/scripts/check-media-entry.cjs" \
  --output "$output_directory/$media_entry_name"

{
  printf 'artifact=%s\n' "$artifact_name"
  printf 'git_revision=%s\n' "$revision"
  printf 'source_date_epoch=%s\n' "$source_date_epoch"
  printf 'node_version=%s\n' "$(node --version)"
  printf 'npm_version=%s\n' "$(npm --version)"
  printf 'package_lock_sha256=%s\n' "$(sha256sum "$repository_root/package-lock.json" | cut -d' ' -f1)"
} > "$output_directory/$inputs_name"

(
  cd "$output_directory"
  sha256sum "$artifact_name" "$sbom_name" "$dependencies_name" "$inputs_name" \
    "$media_entry_name" > SHA256SUMS
)
node "$repository_root/scripts/verify-release.cjs" "$output_directory"
printf 'release_directory=%s\n' "$output_directory"