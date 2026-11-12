#!/usr/bin/env bash
# Build the Hearth Suite desktop installers for the host platform via Tauri and stage
# them (with checksums) into ./dist for the sign stage (P2.7, AC-DESK-1).
#
# Produces, per platform:
#   linux   -> .AppImage + .deb
#   windows -> .msi + .exe (NSIS)
#   macos   -> .dmg + .app
#
# Code signing is driven by tauri.conf.json + the signing environment variables
# (TAURI_SIGNING_*, APPLE_*, and the Windows certificate) provisioned on the
# release runners; unsigned local runs still produce installers for testing.
set -euo pipefail

platform="${1:?usage: package.sh <linux|windows|macos>}"

# Workspace dependencies (no-op when already installed by the job).
pnpm install --frozen-lockfile

# Build stamp shown in Settings > About (AC-WIN-1): the short commit this build
# came from. HEARTH_BUILD_VERSION is separate: it is the integer TUF metadata
# floor used for rollback protection (updater.rs), not a display string.
if [ -z "${HEARTH_BUILD_COMMIT:-}" ]; then
  sha="${GITHUB_SHA:-${CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}}"
  HEARTH_BUILD_COMMIT="${sha:0:7}"
fi
export HEARTH_BUILD_COMMIT

# 1. Frontend bundle (Vite) into apps/desktop/dist. The `...` suffix builds the
#    desktop package's workspace dependencies (design-system tokens, etc.) first.
pnpm --filter "@hearth/desktop..." build

# 2. Icons, generate the platform icon set when the binary icons are absent
#    (they are git-ignored). The source is the 1024x1024 brand icon produced from
#    the @hearth/design-system SVG master (`build:icons`), shared with mobile.
#    `pnpm exec` runs inside apps/desktop, so the path is relative to it.
icons_dir="apps/desktop/src-tauri/icons"
if [ ! -f "$icons_dir/icon.ico" ] || [ ! -f "$icons_dir/icon.icns" ]; then
  pnpm --filter @hearth/desktop exec tauri icon ../mobile/resources/icon.png
fi

# 3. Build the Tauri bundle (compiles the embedded Rust core + installers).
#    CI passes unset signing secrets as empty strings, and Tauri treats an empty
#    APPLE_CERTIFICATE as a certificate to import. Drop empty values so runs
#    without signing material (pull requests, forks) build unsigned installers.
for var in TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD APPLE_CERTIFICATE \
  APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [ -z "${!var:-}" ]; then unset "$var"; fi
done

# 4. Per-build overrides (version, unsigned updater, Windows signing, updater
#    channel) from the environment; see ci/desktop/tauri-overrides.mjs.
if [ -n "${HEARTH_WIN_SIGN_MODE:-}" ] && [ -z "${HEARTH_WIN_SIGN_SCRIPT:-}" ]; then
  HEARTH_WIN_SIGN_SCRIPT="$(pwd)/ci/desktop/windows-sign.ps1"
  if command -v cygpath >/dev/null 2>&1; then
    HEARTH_WIN_SIGN_SCRIPT="$(cygpath -w "$HEARTH_WIN_SIGN_SCRIPT")"
  fi
  export HEARTH_WIN_SIGN_SCRIPT
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "TAURI_SIGNING_PRIVATE_KEY not set: building without updater artifacts (unsigned)"
fi
mkdir -p apps/desktop/src-tauri/target
overrides="apps/desktop/src-tauri/target/build-overrides.conf.json"
node ci/desktop/tauri-overrides.mjs > "$overrides"
build_args=()
if [ "$(cat "$overrides")" != "{}" ]; then
  echo "Tauri overrides: $(cat "$overrides")"
  build_args+=(--config src-tauri/target/build-overrides.conf.json)
fi
pnpm --filter @hearth/desktop exec tauri build ${build_args[@]+"${build_args[@]}"}

# 5. Collect installers, Tauri updater signatures (.sig) and checksums into dist/.
mkdir -p dist
bundle="apps/desktop/src-tauri/target/release/bundle"
if [ -d "$bundle" ]; then
  find "$bundle" -type f \
    \( -name '*.msi' -o -name '*.exe' -o -name '*.dmg' \
       -o -name '*.AppImage' -o -name '*.deb' -o -name '*.app.tar.gz' -o -name '*.sig' \) \
    -exec cp {} dist/ \;
fi

# Always leave a manifest so the platform has at least one artifact to sign.
echo "hearth ${platform} ${GITHUB_SHA:-${CI_COMMIT_SHA:-local}}" > "dist/hearth-${platform}.txt"
(cd dist && for f in *; do
  case "$f" in *.sha256 | *.sig) continue ;; esac
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" > "$f.sha256"
  else
    shasum -a 256 "$f" > "$f.sha256"
  fi
done)

echo "Staged desktop artifacts for ${platform}:"
ls -1 dist
