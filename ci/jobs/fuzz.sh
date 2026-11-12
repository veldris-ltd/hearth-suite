#!/usr/bin/env bash
# Bounded parser fuzzing smoke (AC-QA-3). Needs a nightly toolchain + cargo-fuzz.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
command -v cargo-fuzz >/dev/null 2>&1 || cargo install cargo-fuzz --locked
seconds="${FUZZ_SECONDS:-45}"
# Build for the host: a prebuilt cargo-fuzz (taiki-e/install-action) is a musl
# binary and otherwise defaults to the musl target, which has no sanitiser std.
host="$(rustc +nightly -vV | sed -n 's/^host: //p')"
for target in bundle_read odf_read docx_import xlsx_import legacy_import; do
  ci_group "fuzz $target (${seconds}s)"
  cargo +nightly fuzz run --target "$host" "$target" -- -max_total_time="$seconds" -rss_limit_mb=4096
  ci_endgroup
done
