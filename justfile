# Hearth Suite task runner. Run `just` for the default (lint) or `just <target>`.
# Targets satisfy AC-FND-1: a fresh checkout passes `just lint` and `just build`.

set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Show available recipes.
default:
    @just --list

# Install JS workspace dependencies (Rust deps are fetched by cargo on demand).
setup:
    pnpm install --frozen-lockfile

# Format Rust and TS/JS sources in place.
fmt:
    cargo fmt --all
    pnpm run format

# Lint everything with zero tolerance for warnings (fmt check + clippy + eslint + prettier).
lint: setup
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    pnpm run lint
    pnpm run format:check

# Build the Rust core and the TS workspace.
build: setup
    cargo build --workspace --all-targets
    pnpm run build

# Run Rust and TS unit/integration tests.
test: setup
    cargo test --workspace
    pnpm run test

# Run end-to-end smoke tests.
e2e: setup
    pnpm run e2e

# Run the desktop client in development (Vite dev server + Tauri window).
# Requires the platform webview toolchain (see ci/desktop/package.sh).
desktop-dev: setup
    pnpm --filter @hearth/desktop tauri dev

# Build native desktop installers (.msi/.exe, .dmg, .AppImage/.deb) into dist/ via Tauri.
# Same path as CI: unsigned without signing material, signed when it is provisioned.
# On Windows this needs Git for Windows' bash ahead of WSL's on PATH
# (docs/contributing/windows-build.md).
desktop: setup
    bash ci/desktop/package.sh {{ os() }}

# Run the mobile client in development (Vite dev server for the web layer).
mobile-dev: setup
    pnpm --filter @hearth/mobile dev

# Assemble the mobile distributables (.aab/.apk store + F-Droid; .ipa).
# Requires the platform SDKs + signing material; see ci/mobile/package.sh.
mobile platform: setup
    ./ci/mobile/package.sh {{platform}}

# Supply-chain + licence gate (AC-FND-2). Requires cargo-deny.
audit:
    cargo deny check

# Coverage gates (AC-QA-2): Rust line coverage + TS coverage, fail under threshold.
# Requires cargo-llvm-cov (`cargo install cargo-llvm-cov`).
coverage: setup
    cargo llvm-cov --workspace --fail-under-lines 70
    pnpm run coverage

# Run a parser fuzzer (AC-QA-3). Requires a nightly toolchain + cargo-fuzz.
# Targets: odf_read, docx_import, xlsx_import, legacy_import.
fuzz target="odf_read":
    cargo +nightly fuzz run {{target}}
