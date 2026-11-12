#!/usr/bin/env bash
# Coverage gate (AC-QA-2): Rust lines >= 70%, TypeScript per package.json.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_pnpm_install
command -v cargo-llvm-cov >/dev/null 2>&1 || cargo install cargo-llvm-cov --locked
cargo llvm-cov --workspace --locked --lcov --output-path lcov-rust.info --fail-under-lines 70
pnpm run coverage
