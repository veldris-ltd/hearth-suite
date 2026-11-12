# Hearth Suite mobile, native projects

The mobile client is a [Capacitor](https://capacitorjs.com) app: the **web UI is
the shared client shell** (`@hearth/client-shell`, the same Mantel + module
editors as desktop), and the **Rust core** is embedded as a native library
reached through Capacitor plugins. Only the transport and a few device plugins
differ from desktop.

## Generating the platform projects

The `ios/` and `android/` Xcode/Gradle projects are generated (not committed):

```sh
pnpm --filter "@hearth/mobile..." build      # Vite build → apps/mobile/dist
pnpm --filter @hearth/mobile exec cap add ios
pnpm --filter @hearth/mobile exec cap add android
pnpm --filter @hearth/mobile exec cap sync    # copies dist/ + plugins
```

Then drop the plugin sources from this folder into the generated projects:

| File                          | Destination                                         |
| ----------------------------- | --------------------------------------------------- |
| `ios/HearthCorePlugin.swift`  | `ios/App/App/`                                      |
| `ios/BiometricPlugin.swift`   | `ios/App/App/`                                      |
| `android/HearthCorePlugin.kt` | `android/app/src/main/java/io/veldris/hearthsuite/` |
| `android/BiometricPlugin.kt`  | `android/app/src/main/java/io/veldris/hearthsuite/` |
| `android/app-flavors.gradle`  | merge into `android/app/build.gradle`               |

## The embedded core

- **iOS**, `libhearth_ffi.a` (target `aarch64-apple-ios`) is linked into the App
  target; `HearthCorePlugin.swift` calls the C-ABI (`hearth_call`) directly via a
  bridging header.
- **Android**, `libhearth_ffi.so` (target `aarch64-linux-android`, built with
  `cargo-ndk`) is bundled in `jniLibs/`; `HearthCorePlugin.kt` calls it through a
  small JNI export (`nativeCall`) that forwards to `hearth_ffi::call_json`.

Both speak the identical `{ method, params }` → `{ ok } / { error }` protocol as
the C-ABI and WASM bindings, so the mobile client reuses the typed
`HearthClient` with no core-surface changes.

## Acceptance criteria

- **AC-MOB-1 (parity)**, the UI and core are shared with desktop; every core
  method is offline-capable (`OFFLINE_METHODS` in `src/core.mjs`), so editing and
  Seal work fully offline.
- **AC-MOB-2 (on-device AI)**, `ensureEmberModel` defaults to the smallest viable
  Phi tier (`ember_tiers` FFI) and downloads heavier weights only on Wi-Fi with
  consent (`canDownloadWeights`).
- **AC-MOB-3 (biometric unlock)**, `BiometricPlugin` gates the identity seed
  behind Face ID / Touch ID / `BiometricPrompt`; the key sits in the Keychain /
  Android Keystore and is usable only after a successful prompt.
- **AC-MOB-4 (distribution)**, `play` and `foss` Android flavours (store `.aab`
  and F-Droid/sideload `.apk`); the F-Droid recipe is in `apps/mobile/fdroid/`.

## Store policy notes

- No background network; the only network is the user-initiated model-weights
  download (Wi-Fi + consent) and opt-in sync.
- No tracking/analytics SDKs; the FOSS flavour carries no proprietary code.
- Biometric usage strings (`NSFaceIDUsageDescription`) and the Android
  `USE_BIOMETRIC` permission are declared in the generated projects.
