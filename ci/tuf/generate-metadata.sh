#!/usr/bin/env bash
# Generate TUF-style release metadata for the artifacts in a directory.
#
# When the release role seed is provisioned (HEARTH_RELEASE_ROLE_SEED, base64 of
# 32 bytes, held as a CI secret), this produces SIGNED `targets` metadata via the
# `hearth-tuf-sign` tool, which signs with the ML-DSA-65 role key through
# hearth-seal. release-service and the desktop client verify that signature
# against their pinned roots before trusting an update (AC-CI-3 / AC-REL-1..3,
# diagram 06d).
#
# Without a seed (local builds and forks that hold no key), it emits the unsigned
# metadata shell and warns: the service and clients then correctly REFUSE it.
#
# Env (when signing):
#   HEARTH_RELEASE_ROLE_SEED  base64 of the 32-byte role seed (required to sign)
#   HEARTH_ROOT_KEY_ID        key id to stamp (default: hearth-release)
#   HEARTH_RELEASE_VERSION    monotonic metadata version (default: 1)
#
# Usage: generate-metadata.sh <artifact-dir>
set -euo pipefail

dir="${1:?usage: generate-metadata.sh <artifact-dir>}"
out="$dir/targets.json"

# ---- Signed path: delegate to the Rust signer (the producer half of the same
# verification code the service and client run) ------------------------------
if [ -n "${HEARTH_RELEASE_ROLE_SEED:-}" ]; then
  keyid="${HEARTH_ROOT_KEY_ID:-hearth-release}"
  version="${HEARTH_RELEASE_VERSION:-1}"
  cargo run -q --release -p hearth-release --bin hearth-tuf-sign -- \
    sign --dir "$dir" --version "$version" --keyid "$keyid" --out "$out"
  echo "Wrote SIGNED TUF targets metadata: $out (keyid=$keyid, version=$version)"
  exit 0
fi

# ---- Unsigned fallback (no role seed): emit the shell and warn ---------------
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

filesize() { wc -c <"$1" | tr -d ' '; }

targets=""
for f in "$dir"/*; do
  [ -f "$f" ] || continue
  case "$f" in *.json | *.sig | *.pem | *.sha256) continue ;; esac
  name="$(basename "$f")"
  entry=$(printf '    "%s": { "hashes": { "sha256": "%s" }, "length": %s }' \
    "$name" "$(sha256 "$f")" "$(filesize "$f")")
  if [ -z "$targets" ]; then targets="$entry"; else targets="$targets,
$entry"; fi
done

cat >"$out" <<JSON
{
  "signed": {
    "_type": "targets",
    "spec_version": "1.0.0",
    "version": 1,
    "targets": {
$targets
  }
  },
  "signatures": []
}
JSON

echo "Wrote UNSIGNED TUF targets metadata: $out"
echo "::warning::TUF metadata is UNSIGNED (HEARTH_RELEASE_ROLE_SEED not set); release-service and clients will refuse it. Provision the role seed to sign."
