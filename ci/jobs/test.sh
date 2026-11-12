#!/usr/bin/env bash
# Unit, integration and property tests (AC-QA-1, AC-QA-3): Rust workspace,
# TypeScript module logic, and the tooling tests.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_pnpm_install
ci_group "cargo test"; cargo test --workspace --all-features --locked; ci_endgroup
ci_group "js tests";   pnpm -r --if-present test; ci_endgroup
