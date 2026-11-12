# Hearth Suite

**An open-source, offline-first, privacy-first productivity suite, the modern heir to Microsoft Works.**

Hearth Suite is a suite of four core applications, **Writer**, **Sheets**, **Records**, and
**Calendar**, unified by a calm workspace called **The Mantel**. Everything stays on your
own device: documents, encryption keys, and AI. Each project is a **Bundle** that can be
**Sealed** with post-quantum end-to-end encryption in one tap. An on-device AI assistant,
**Ember**, helps with drafting, formulas, and queries without anything leaving the device.

It works fully offline, requires no account, costs nothing, and is released open-source by
Veldris Ltd. Hearth Suite is the property of Veldris Ltd.

## Editions

| Edition              | Licence                   | What it includes                                                                                                              |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Hearth Suite**     | Apache-2.0, open source   | The complete suite: all four modules, The Mantel, Ember, Seal, open formats, local storage and the self-hostable services.    |
| **Hearth Suite Pro** | Proprietary, Veldris Ltd. | Everything in Hearth Suite plus the commercial power layer (Macros, The Forge, Kindling, Hallmark, Marketplace, Connections). |

Safety and security features are never paywalled: Seal, the encrypted store and every
security update are part of the open-source edition.

> **Status:** feature-complete across all build phases (P0–P4). The Rust core, the four
> module logic layers, the desktop (Tauri) and mobile (Capacitor) clients, the optional
> self-hostable cloud services, and the full test/security/observability tooling are in
> place and pass the verification gate. See `docs/launch-checklist.md` for the v1.0 release
> gate.

## Principles

- **Local-first, offline-first**, all core functions work with no network and no account.
- **Post-quantum E2E encryption** is a property of every Bundle, not a bolt-on feature.
- **On-device open-source AI only**, zero cloud inference; no telemetry by default.
- **Open formats, open licence**, ODF canonical, `.docx`/`.xlsx` round-trip, Apache-2.0.
- **A Rust core with thin clients**, one shared core exposed to desktop, mobile, and web.

## Architecture in one paragraph

A single Rust core (Bundle I/O, the post-quantum **Seal**, the encrypted store, CRDT sync,
the Ember AI bridge) is exposed through one typed facade, `crates/ffi`, over a JSON
dispatch reachable as a native C-ABI (desktop/mobile) and as WASM (web). Every client speaks
that one protocol via the typed `@hearth/core-client`; the UI is framework-agnostic DOM
shared between desktop and mobile through `@hearth/client-shell`. The optional cloud services
are zero-knowledge and self-hostable. The C4 diagrams are in `docs/build/diagrams/`.

## Repository layout

```
crates/            Rust core + service domain logic (one cargo workspace)
  bundle/            Bundle container (manifest, documents, assets)
  odf-io/            OpenDocument I/O + .docx/.xlsx round-trip
  legacy-import/     Microsoft Works .wps/.wks/.wdb import
  crdt-sync/         Optional co-editing / zero-knowledge sync deltas
  key-manager/       Local identity and key lifecycle
  seal/              Post-quantum Seal (the only crypto surface)
  ember-bridge/      On-device AI bridge (llama.cpp / GGUF)
  store/             SQLite metadata + encrypted document vault
  ffi/               FFI / WASM bindings to the UI layer
  release/           Signed TUF release metadata + update verification
  admin-core/        Admin Control Panel domain logic (RBAC, audit, …)
  observability/     Privacy-preserving logs/metrics for the services
  relay-core/        Sync-relay quotas, blob lifecycle/GC, rate limiting
  key-directory-core/ Public-key directory + append-only transparency log
apps/              TypeScript UI workspace (pnpm)
  shell/             The Mantel (unified workspace)
  writer/ sheets/ records/ calendar/   the four editors
  desktop/           Tauri desktop client      mobile/   Capacitor iOS/Android client
  admin/             Admin Control Panel web UI  e2e/     offline end-to-end journeys
packages/          Shared TS packages (core-client, design-system, client-shell)
services/          Optional self-hostable cloud
  sync-relay/  key-directory/  release-service/  admin-cp/  observability/
fuzz/              cargo-fuzz targets for the parsers
docs/              Guides, architecture diagrams, roadmap, security, brand
```

## Prerequisites

Required for the core workspace:

- A stable [Rust](https://rustup.rs) toolchain (edition 2021, Rust ≥ 1.82).
- [Node.js](https://nodejs.org) ≥ 22 and [pnpm](https://pnpm.io) ≥ 10.
- [`just`](https://github.com/casey/just) (a `Makefile` fallback is provided).

Optional, per task:

- **Desktop packaging**, the Tauri prerequisites for your OS (e.g. WebView2 on Windows,
  Xcode CLT on macOS, `webkit2gtk` + `librsvg` + `patchelf` on Linux). See
  [`ci/desktop/package.sh`](ci/desktop/package.sh).
- **Mobile**, the [Capacitor](https://capacitorjs.com) prerequisites (Xcode for iOS,
  Android SDK/NDK for Android).
- **Self-hosting services**, Docker / Docker Compose (and Helm + a cluster for k8s).
- **Coverage**, `cargo install cargo-llvm-cov`. **Fuzzing**, a nightly toolchain +
  `cargo install cargo-fuzz`.

## Quick start

```sh
git clone https://github.com/veldris-ltd/hearth-suite.git
cd hearth-suite

just setup     # install JS workspace dependencies (pnpm)
just lint      # rustfmt + clippy (-D warnings) + eslint + prettier
just test      # Rust + TS unit/integration tests
just e2e       # offline end-to-end journeys
just build     # build the Rust core and the TS workspace
```

`just` with no target lists every recipe. Without `just`, substitute `make <target>`.

## Building

| Goal                            | Command                                                  |
| ------------------------------- | -------------------------------------------------------- |
| Rust core (all crates)          | `cargo build --workspace` (or `just build`)              |
| TS workspace (typecheck/bundle) | `pnpm -r build` / `pnpm -s typecheck`                    |
| Desktop installers (this OS)    | `just desktop` → `.msi` / `.dmg` / `.AppImage` / `.deb`  |
| Mobile distributables           | `just mobile android` or `just mobile ios`               |
| Service images                  | `docker build -f services/<name>/Dockerfile -t <name> .` |

Release builds are reproducible and the CI pipeline signs every artifact and attaches SLSA
provenance + an SBOM (see `docs/launch-checklist.md`).

## Running locally

### The core and tests

```sh
cargo test --workspace          # the Rust core + FFI integration + property tests
pnpm -r --if-present test       # the TS module logic (node:test)
pnpm -r --if-present e2e        # offline create → edit → Ember → Seal → reopen journey
```

### Desktop client (Tauri)

Runs the real web UI in a native window over the embedded Rust core:

```sh
just desktop-dev                # = pnpm --filter @hearth/desktop tauri dev
```

(Needs the Tauri platform prerequisites above. The first run builds the Rust core, so allow
a few minutes.)

### Mobile client (Capacitor)

```sh
just mobile-dev                 # Vite dev server for the shared web layer
# then add a platform and run on a device/simulator:
pnpm --filter @hearth/mobile exec cap add ios       # or: android
pnpm --filter @hearth/mobile exec cap run ios
```

See [`apps/mobile/native/README.md`](apps/mobile/native/README.md) for wiring the native core
plugins.

### Admin Control Panel (web UI)

```sh
pnpm --filter @hearth/admin dev # Vite dev server for the operator console
```

### Optional cloud services

None are required to use Hearth Suite. To self-host one (no Veldris infrastructure needed), set its passwords first: the compose files have no defaults and refuse to start until they are set (see each service's README).

```sh
docker compose -f services/sync-relay/docker-compose.yml      up --build  # zero-knowledge relay
docker compose -f services/key-directory/docker-compose.yml   up --build  # public-key directory
docker compose -f services/release-service/docker-compose.yml up --build  # TUF update channels
docker compose -f services/admin-cp/...                                   # operator console (see its README)
```

Each service also ships a Helm chart under `services/<name>/helm/`. See
[`docs/self-hosting.md`](docs/self-hosting.md).

## Testing & quality gates

| Command         | What it checks                                                      |
| --------------- | ------------------------------------------------------------------- |
| `just lint`     | rustfmt + clippy `-D warnings`, eslint, prettier                    |
| `just test`     | Rust + TS unit/integration tests                                    |
| `just e2e`      | offline end-to-end client journeys                                  |
| `just coverage` | Rust (`cargo-llvm-cov`) + TS (`c8`) coverage, fails under threshold |
| `just audit`    | `cargo deny`, open-licence + advisory + source gate                 |
| `just fuzz <t>` | a parser fuzz target (nightly + `cargo-fuzz`)                       |

CI runs lint → tests (3 OS) → e2e, a11y, SAST, coverage → audit/SBOM → reproducible-build, fuzz →
build matrix → sign (cosign + SLSA + TUF) → staged publish. Every job is a script in
[`ci/jobs/`](ci/jobs/), so GitHub Actions (`.github/workflows/`) and GitLab CI
(`.gitlab-ci.yml`) run the same steps, and any job can be run locally, for example
`ci/jobs/lint.sh`.

> **Note for contributors on networked/virtual drives:** if `cargo` intermittently fails with
> a Windows `os error 121` (semaphore timeout) during linking, point the build at a local
> disk: `CARGO_TARGET_DIR=%LOCALAPPDATA%\hearth-target cargo test --workspace`.

## Documentation

- [Getting started](docs/getting-started.md), install to first sealed Bundle.
- [User guide](docs/user-guide.md), every module in depth.
- [Self-hosting the optional cloud](docs/self-hosting.md).
- [Building the Windows test client](docs/contributing/windows-build.md), from a clean Windows 11
  machine to a checked installer.
- [Security policy](SECURITY.md) · [Threat model](docs/security/threat-model.md) ·
  [Crypto audit package](docs/security/crypto-audit-package/README.md).
- [Test automation](docs/build/gates/test-automation.md) · [Observability](docs/build/gates/observability.md).
- [Launch checklist](docs/launch-checklist.md) · [Dependency licences](docs/dependency-licences.md) ·
  [Brand & trademark usage](docs/brand.md).
- Architecture diagrams: `docs/build/diagrams/` (Mermaid and draw.io sources).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report
a security issue, follow [SECURITY.md](SECURITY.md), please do **not** open a public issue for
vulnerabilities.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). "Hearth Suite by Veldris Ltd." and the
flame logo are brand assets and are not covered by the code licence.

---

Hearth Suite is the property of Veldris Ltd., registered in England and Wales, company no. 17366869. Registered office: Two Snowhill, Birmingham, B4 6WR. [veldris.io](https://veldris.io) ·
hello@veldris.io
