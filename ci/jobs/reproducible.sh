#!/usr/bin/env bash
# Reproducible-build check (AC-CI-4): build the core twice, compare hashes.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
export SOURCE_DATE_EPOCH=1700000000 CARGO_INCREMENTAL=0
export RUSTFLAGS="--remap-path-prefix=${CI_ROOT}=/hearth -C strip=symbols"
cargo build --release --locked -p hearth-ffi --target-dir target/repro-a
cargo build --release --locked -p hearth-ffi --target-dir target/repro-b
# Compare the shipped libraries only: the .rlib metadata and the .d dep-info
# file record the target directory, which differs between the two builds.
digest() {
  find "$1/release" -maxdepth 1 -type f \( -name 'libhearth_ffi.so' -o -name 'libhearth_ffi.a' \
    -o -name 'libhearth_ffi.dylib' -o -name 'hearth_ffi.dll' \) -exec sha256sum {} + |
    awk '{print $1}' | sort | sha256sum
}
ls target/repro-a/release/libhearth_ffi.so >/dev/null || { ci_error "no shipped library was built"; exit 1; }
a="$(digest target/repro-a)"; b="$(digest target/repro-b)"
echo "build A: $a"; echo "build B: $b"
[ "$a" = "$b" ] || { ci_error "reproducible build check failed: output hashes differ"; exit 1; }
echo "Reproducible build verified."
