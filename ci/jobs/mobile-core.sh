#!/usr/bin/env bash
# Build the embedded core library for a mobile target and the shared web layer.
#   mobile-core.sh <ios|android>
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
platform="${1:?usage: mobile-core.sh <ios|android>}"
ci_pnpm_install
if [ "$platform" = "android" ]; then
  command -v cargo-ndk >/dev/null 2>&1 || cargo install cargo-ndk --locked
  cargo ndk -t arm64-v8a build --release --locked -p hearth-ffi
  target=aarch64-linux-android
else
  target=aarch64-apple-ios
  cargo build --release --locked -p hearth-ffi --target "$target"
fi
pnpm --filter "@hearth/mobile..." build
mkdir -p dist
find target -path "*${target}*release*" -name 'libhearth_ffi*' -type f -exec cp {} dist/ \;
echo "hearth ${platform} ${target} $(ci_sha)" > "dist/hearth-${platform}.txt"
(cd dist && for f in *; do
  case "$f" in *.sha256) continue ;; esac
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f" > "$f.sha256"; else shasum -a 256 "$f" > "$f.sha256"; fi
done)
