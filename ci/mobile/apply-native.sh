#!/usr/bin/env bash
# Wire Hearth Suite's native plugins into the generated Capacitor project after
# `cap add`, so a build needs no manual patching (P2-N1 / AC-MOB-4).
#
#   android: copy the Kotlin plugins into the app package; apply the shared
#            flavours + plugin-deps gradle via a single `apply from` line.
#   ios:     copy the Swift plugins + the C bridging header into the App target,
#            and point SWIFT_OBJC_BRIDGING_HEADER at it.
#
# Idempotent: safe to run on every `cap sync`.
set -euo pipefail
platform="${1:?usage: apply-native.sh <android|ios>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
native="$root/apps/mobile/native"

# OS reminders (seam #11, P2-CL5): the Capacitor local-notifications plugin is
# added at device-build time, not vendored in the offline workspace store. Pull
# it in before `cap sync` so the JS wiring in apps/mobile/src/main.ts resolves.
if ! node -e "require.resolve('@capacitor/local-notifications')" >/dev/null 2>&1; then
  echo "installing @capacitor/local-notifications (OS reminders)…"
  (cd "$root/apps/mobile" && pnpm add @capacitor/local-notifications)
fi

case "$platform" in
  android)
    pkg_dir="$root/apps/mobile/android/app/src/main/java/io/veldris/hearthsuite"
    mkdir -p "$pkg_dir"
    cp "$native/android/HearthCorePlugin.kt" "$native/android/BiometricPlugin.kt" "$pkg_dir/"

    cp "$native/android/app-flavors.gradle" "$root/apps/mobile/android/app/hearth-flavors.gradle"
    app_gradle="$root/apps/mobile/android/app/build.gradle"
    if ! grep -q "hearth-flavors.gradle" "$app_gradle"; then
      printf '\napply from: "hearth-flavors.gradle"\n' >>"$app_gradle"
    fi

    # Register the local plugins with the Capacitor bridge (auto-load doesn't
    # cover app-local plugins).
    main_activity="$pkg_dir/MainActivity.kt"
    if [ ! -f "$main_activity" ]; then
      cat >"$main_activity" <<'KOTLIN'
package io.veldris.hearthsuite

import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    registerPlugin(HearthCorePlugin::class.java)
    registerPlugin(BiometricPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
KOTLIN
    fi
    ;;

  ios)
    app_dir="$root/apps/mobile/ios/App/App"
    mkdir -p "$app_dir"
    cp "$native/ios/HearthCorePlugin.swift" "$native/ios/BiometricPlugin.swift" "$app_dir/"
    cp "$native/ios/Hearth-Bridging-Header.h" "$app_dir/"
    # Point the App target at the bridging header (idempotent best-effort).
    pbxproj="$root/apps/mobile/ios/App/App.xcodeproj/project.pbxproj"
    if [ -f "$pbxproj" ] && ! grep -q "Hearth-Bridging-Header.h" "$pbxproj"; then
      # The CI mobile runner has `xcodeproj`/`ruby`; set the build setting there.
      ruby -e '
        require "xcodeproj"
        p = Xcodeproj::Project.open(ARGV[0])
        p.targets.each do |t|
          t.build_configurations.each do |c|
            c.build_settings["SWIFT_OBJC_BRIDGING_HEADER"] = "App/Hearth-Bridging-Header.h"
          end
        end
        p.save
      ' "$root/apps/mobile/ios/App/App.xcodeproj" || \
        echo "::warning::could not set SWIFT_OBJC_BRIDGING_HEADER automatically; set App/Hearth-Bridging-Header.h on the App target"
    fi
    ;;

  *)
    echo "unknown platform: $platform" >&2
    exit 1
    ;;
esac

echo "wired Hearth Suite native plugins for $platform"
