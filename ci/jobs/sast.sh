#!/usr/bin/env bash
# Static analysis with Semgrep (Rust, TypeScript, secrets). Fails on any
# blocking finding. Semgrep is installed from PyPI at a pinned version when it
# is not already on PATH.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
if ! command -v semgrep >/dev/null 2>&1; then
  venv="$(ci_tmp)/semgrep-venv"
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet "semgrep==${SEMGREP_VERSION:-1.180.0}"
  PATH="$venv/bin:$PATH"
fi
# rust.lang.security.unsafe-usage is excluded because `unsafe` is already gated
# by the compiler: the workspace sets `unsafe_code = "warn"` and lint runs with
# -D warnings, so only crates that opt in with #![allow(unsafe_code)] (the FFI
# boundary in crates/ffi, each block carrying a SAFETY comment) can use it.
# Other false positives are suppressed inline with a reasoned `nosemgrep`.
semgrep scan --error --metrics=off \
  --exclude-rule rust.lang.security.unsafe-usage.unsafe-usage \
  --config p/default --config p/security-audit --config p/secrets \
  --config p/rust --config p/typescript
