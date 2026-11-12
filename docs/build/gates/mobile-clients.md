# Mobile clients (P2.8)

Hearth Suite's iOS and Android clients are **Capacitor** apps that share the web UI and
the Rust core with desktop. The web UI is the shared client shell
(`@hearth/client-shell`, the same Mantel + Writer/Sheets/Records/Calendar as
desktop, refactored out of the desktop app in this phase). The core is embedded
as a native library reached through a Capacitor plugin; only the transport and a
few device plugins differ from desktop.

## Layout

```
packages/client-shell/        Shared host: mountWorkspace(client, root) (desktop + mobile).
apps/mobile/
  index.html, vite.config.ts, capacitor.config.ts
  src/
    main.ts            Biometric gate → mountWorkspace → Ember setup.
    transport.ts       CapacitorTransport → native HearthCore plugin.
    biometric.ts       Vault unlock via the Biometric plugin.
    ember-mobile.ts    Tier choice + Wi-Fi/consent weights download.
    core.mjs/.d.mts    Pure logic (tier, download gate, unlock FSM, parity), tested.
  native/
    ios/*.swift        HearthCore + Biometric Capacitor plugins.
    android/*.kt       HearthCore + Biometric plugins; app-flavors.gradle.
  fdroid/*.yml         F-Droid build recipe.
```

`packages/client-shell` is the proof that the web UI is genuinely shared: both
clients call `mountWorkspace(client, root)`; desktop layers a verified-update
banner on top, mobile layers a biometric gate.

## AC-MOB-1, offline-first parity

The clients reuse the same `@hearth/*` UI packages and the same `HearthClient`
over the native core. Every core method is offline-capable (`OFFLINE_METHODS` in
`src/core.mjs`), there is no network-only operation, so core editing and Seal
reach desktop parity with no connectivity. Opt-in sync layers on top when enabled.

## AC-MOB-2, on-device AI within memory constraints

The FFI exposes the available model tiers (`ember_tiers` → `EmberTier[]`, backed
by `ember-bridge::ModelTier`). `chooseTier` always defaults to the smallest
viable Phi tier (`mobile_default`); a heavier tier is used only when the user
opts in *and* the device has the RAM (`min_ram_mb`). `canDownloadWeights` permits
a weights download only on **Wi-Fi with explicit consent**, never on cellular,
never silently. Weights are downloaded to app storage, never bundled.

## AC-MOB-3, biometric vault unlock

The identity seed lives in the iOS Keychain / Android Keystore, usable only
inside a successful biometric authentication (Face ID / Touch ID /
`BiometricPrompt`, with device-passcode fallback). `unlockVault` drives the
unlock state machine (`nextUnlockState`); the only transition into `unlocked` is
a `success` event from the prompt, which is unit-tested.

## AC-MOB-4, distribution

Android ships two flavours (`app-flavors.gradle`): `play` (Google Play `.aab`)
and `foss` (F-Droid / direct-sideload `.apk`, no proprietary dependencies). The
F-Droid build recipe is `apps/mobile/fdroid/io.veldris.hearthsuite.yml`. iOS ships
through the App Store. `ci/mobile/package.sh` performs the signed native assembly
on the release runners (Android SDK / Xcode + signing material, provisioned in
P3.3).

## Store-policy posture

No background network, no tracking/analytics SDKs, model weights are a
user-initiated Wi-Fi download, and the FOSS flavour carries no proprietary code -
keeping within both Apple and Google policies and F-Droid's inclusion rules.

## What builds where

As with the Tauri desktop binary, the native iOS/Android projects are not part of
the toolchain-light workspace gate: they are generated with `cap add` and built
on the mobile runners. The verifiable substance, the FFI tier surface, the
shared shell, and the mobile decision logic, is covered by `cargo test`,
`tsc`, and `node:test` in CI.

## Icons, splash & store metadata (P2-N2)

Icons and splash screens are generated from the design-system master, not edited
by hand. `apps/mobile/resources/icon.png` (+ the Android adaptive layers) comes
from `pnpm --filter @hearth/design-system build:icons`; `pnpm --filter
@hearth/mobile run assets` then runs `@capacitor/assets` (pinned, via `pnpm dlx`) to project the full
native icon and splash sets onto the ember/warm brand colours. `package.sh` runs
this after `cap sync`.

Store listing copy lives in `apps/mobile/fastlane/metadata/` (Play under
`android/en-US`, App Store under `ios/en-US`): title, descriptions, keywords,
release notes, and the privacy/support/marketing URLs. `fastlane supply`
(Play) and `fastlane deliver` (App Store) upload it alongside the artifacts.

## Signing & submission (P2-N2)

The native assembly is signed on the release runners; keys are CI secrets, never
committed.

- **Android.** `app-flavors.gradle` adds a release `signingConfig` read from the
  environment (`HEARTH_ANDROID_KEYSTORE`, `…_PASSWORD`, `…_KEY_ALIAS`,
  `…_KEY_PASSWORD`). `package.sh android` builds `:app:bundlePlayRelease` (the
  Play `.aab`) and `:app:assembleFossRelease` (the F-Droid / sideload `.apk`).
  Play submission is `fastlane supply`; F-Droid builds reproducibly from
  `apps/mobile/fdroid/io.veldris.hearthsuite.yml`.
- **iOS.** `package.sh ios` archives and exports with
  `apps/mobile/ios/ExportOptions.plist` (App Store, automatic signing via the
  App Store Connect API key / provisioning profile on the runner); `fastlane
  deliver` uploads the build and metadata.
- **Biometric unlock + keystore.** The identity seed is held in the Android
  Keystore-backed store / iOS Keychain (device-only) and released to the core
  only after a successful biometric prompt (AC-MOB-3); the native plugins wire
  this (`HearthCorePlugin` + `BiometricPlugin`).
