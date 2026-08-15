#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
release_dir="${RELEASE_DIR:-$project_root/release}"
universal_target="universal-apple-darwin"
app_name="YC Todo"
binary_name="yc-todo"
app_path="$project_root/src-tauri/target/$universal_target/release/bundle/macos/$app_name.app"
archive_path="$release_dir/YC-Todo-macOS-universal.zip"
checksum_path="$archive_path.sha256"
codesign_identity="${CODESIGN_IDENTITY:--}"

cd "$project_root"

version="$(node -p 'require("./package.json").version')"
installed_targets="$(rustup target list --installed)"

for required_target in aarch64-apple-darwin x86_64-apple-darwin; do
  if [[ "$installed_targets" != *"$required_target"* ]]; then
    echo "Missing Rust target: $required_target" >&2
    echo "Install both macOS targets before building a Universal release." >&2
    exit 1
  fi
done

# Build only the .app bundle. The release archive below is the public artifact;
# avoiding DMG generation keeps local and CI packaging deterministic.
npm run tauri build -- --bundles app --target "$universal_target" --no-sign

if [[ ! -x "$app_path/Contents/MacOS/$binary_name" ]]; then
  echo "Expected app executable was not created: $app_path" >&2
  exit 1
fi

sign_args=(--force --deep --sign "$codesign_identity")
if [[ "$codesign_identity" != "-" ]]; then
  sign_args+=(--options runtime --timestamp)
fi

if [[ -n "${CODESIGN_ENTITLEMENTS:-}" ]]; then
  sign_args+=(--entitlements "$CODESIGN_ENTITLEMENTS")
fi

codesign "${sign_args[@]}" "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"

architectures="$(lipo -archs "$app_path/Contents/MacOS/$binary_name")"
if [[ "$architectures" != *"arm64"* || "$architectures" != *"x86_64"* ]]; then
  echo "Universal verification failed; found: $architectures" >&2
  exit 1
fi

mkdir -p "$release_dir"
rm -f "$archive_path" "$checksum_path"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$archive_path"

(
  cd "$release_dir"
  shasum -a 256 "$(basename "$archive_path")" > "$(basename "$checksum_path")"
)

archive_size="$(du -h "$archive_path" | awk '{print $1}')"

echo
echo "YC Todo $version release is ready."
echo "Architectures: $architectures"
echo "Archive: $archive_path ($archive_size)"
echo "Checksum: $checksum_path"
