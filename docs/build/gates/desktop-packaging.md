# Desktop client packaging (P2.7)

Hearth Suite ships as a native desktop app for Windows, macOS, and Linux using
**Tauri**: the Rust core is embedded in the app process and the web UI renders in
the platform's system webview (Edge WebView2 / WKWebView / WebKitGTK). This keeps
the footprint small and honours the "runs on anything" goal (`AC-DESK-2`).

## Layout

```
apps/desktop/
  index.html, vite.config.ts        Web entry; bundled by Vite.
  src/
    main.ts                         Bootstraps the client + update check.
    app.ts                          Host shell: Mantel + the four module editors.
    transport.ts                    HearthClient transport over Tauri `invoke`.
    core.mjs / core.d.mts           Pure request/envelope helpers (unit-tested).
    update.ts                       Verified-update prompt (calm, opt-in).
  src-tauri/                        The native binary (NOT a Cargo workspace member).
    tauri.conf.json                 Bundle targets, signing, updater config.
    src/commands.rs                 `hearth_invoke` → hearth_ffi::call_json.
    src/state.rs                    The embedded HearthCore + local store/identity.
    src/updater.rs                  TUF verification gate (hearth-release).
    src/backend.rs                  On-device inference backend (offline-safe).
```

The webview talks to the core through a single command, `hearth_invoke`, which
forwards the request to `hearth_ffi::call_json`, the *same* JSON dispatch the
C-ABI and WASM bindings use. So the desktop client speaks the identical protocol
as every other Hearth Suite front-end; there is no desktop-specific core surface.

`src-tauri` is deliberately excluded from the root Cargo workspace (see
`Cargo.toml` `exclude`) so the toolchain-light core checks (`cargo test
--workspace`, `cargo deny`, reproducible-build) never have to provision the
platform webview SDKs. It depends on the workspace crates by path and builds via
`just desktop` or the CI `build` job.

## Installers (`AC-DESK-1`)

`bundle.targets` in `tauri.conf.json` produces, per platform:

| Platform | Artifacts            |
| -------- | -------------------- |
| Windows  | `.msi`, `.exe` (NSIS)|
| macOS    | `.dmg`, `.app`       |
| Linux    | `.AppImage`, `.deb`  |

`ci/desktop/package.sh` builds the frontend, generates the icon set, runs
`tauri build`, and stages the installers (with SHA-256 sums) into `dist/` for the
sign stage.

## Code signing (`AC-CI-3`)

Signing is driven by `tauri.conf.json` plus signing secrets on the release
runners:

- **Windows**, Authenticode via the certificate thumbprint + timestamp URL.
- **macOS**, Developer ID signing + notarisation (`APPLE_*` secrets, hardened
  runtime entitlements in `entitlements.plist`).
- **Linux**, AppImage/deb signing.
- **Updater artifacts**, signed with `TAURI_SIGNING_PRIVATE_KEY`.

The CI `sign` stage additionally cosign-signs every artifact and rejects any
unsigned one, and emits the TUF `targets` metadata.

## Verified auto-update (`AC-DESK-3`, diagram 06d)

The update path is **fail-closed** and verified against pinned roots:

1. The client fetches signed TUF `targets` metadata from the release channel.
2. `hearth-release` verifies the metadata signature against the **pinned root
   keys baked into the binary** (post-quantum ML-DSA-65, via `hearth-seal`), and
   rejects rollbacks.
3. The platform artifact is downloaded.
4. `VerifiedTargets::verify_artifact` re-checks the downloaded bytes' **hash and
   length** against the signed metadata. Nothing is written to disk until this
   passes.
5. Only then is the user prompted to install the verified update.

The cryptographic substance lives in the `crates/release` crate and is
unit-tested there (signature, hash, length, rollback, untrusted-signer, and
unsigned-metadata cases); `src-tauri/src/updater.rs` is the thin Tauri
orchestration plus the pinned-root configuration. The production root public key
and release-channel endpoints are provisioned by the Release Service in P3.3.
