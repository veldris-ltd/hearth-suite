#!/usr/bin/env bash
# Assemble the Hearth Suite mobile distributables (AC-MOB-4).
#
# Prerequisites provisioned on the release runners (P3.3): the platform Rust core
# (libhearth_ffi for the mobile target), the Android SDK / Xcode, and the signing
# material (Play upload key + F-Droid; Apple provisioning profile). The core CI
# `build` job builds the embeddable library + web layer; this script does the
# full native assembly and is invoked by the signed release pipeline.
set -euo pipefail
platform="${1:?usage: package.sh <android|ios>}"

# Workspace dependencies (no-op when already installed by the job).
pnpm install --frozen-lockfile

# Shared web UI (client-shell) + workspace deps, then add/sync the platform.
pnpm --filter "@hearth/mobile..." build
pnpm --filter @hearth/mobile exec cap add "$platform" || true
pnpm --filter @hearth/mobile exec cap sync "$platform"

# Wire the native plugins (HearthCore + Biometric), bridging header, gradle
# flavours and plugin deps into the generated project, no manual patching.
bash "$(dirname "$0")/apply-native.sh" "$platform"

# Generate the native icon + splash sets from the design-system master
# (resources/icon.png on the ember/warm brand colours).
pnpm --filter @hearth/mobile run assets

mkdir -p dist
case "$platform" in
  android)
    pushd apps/mobile/android >/dev/null
    # Store bundle (.aab) and the FOSS/sideload build (.apk), AC-MOB-4.
    ./gradlew :app:bundlePlayRelease :app:assembleFossRelease
    popd >/dev/null
    find apps/mobile/android/app/build/outputs -type f \
      \( -name '*.aab' -o -name '*.apk' \) -exec cp {} dist/ \;
    ;;
  ios)
    xcodebuild -workspace apps/mobile/ios/App/App.xcworkspace -scheme App \
      -configuration Release -archivePath build/App.xcarchive archive
    xcodebuild -exportArchive -archivePath build/App.xcarchive \
      -exportOptionsPlist apps/mobile/ios/ExportOptions.plist -exportPath dist
    ;;
  *)
    echo "unknown platform: $platform" >&2
    exit 1
    ;;
esac

echo "hearth ${platform} ${GITHUB_SHA:-local}" > "dist/hearth-${platform}.txt"
(cd dist && for f in *; do
  case "$f" in *.sha256) continue ;; esac
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" > "$f.sha256"
  else
    shasum -a 256 "$f" > "$f.sha256"
  fi
done)
ls -1 dist
