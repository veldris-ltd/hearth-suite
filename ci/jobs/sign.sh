#!/usr/bin/env bash
# Sign every release artifact (AC-CI-3): Sigstore keyless signatures (GitHub
# OIDC, or GitLab's SIGSTORE_ID_TOKEN), TUF-signed release metadata (ML-DSA-65
# role key), and a hard failure if any artifact is left unsigned.
#   sign.sh <artifact-dir>
# Sigstore output is <file>.cosign.sig / <file>.cosign.pem, so it never collides
# with the Tauri updater signature <file>.sig that ci/desktop/package.sh keeps.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
dir="${1:?usage: sign.sh <artifact-dir>}"
ci_need cosign
shopt -s nullglob
files=("$dir"/*)
[ ${#files[@]} -gt 0 ] || { ci_error "no artifacts in $dir"; exit 1; }
for f in "${files[@]}"; do
  case "$f" in *.sha256|*.sig|*.pem|*.json) continue ;; esac
  cosign sign-blob --yes --output-signature "$f.cosign.sig" --output-certificate "$f.cosign.pem" "$f"
done
HEARTH_RELEASE_VERSION="${HEARTH_RELEASE_VERSION:-${GITHUB_RUN_NUMBER:-${CI_PIPELINE_IID:-1}}}" \
  ./ci/tuf/generate-metadata.sh "$dir"
rc=0
for f in "${files[@]}"; do
  case "$f" in *.sha256|*.sig|*.pem|*tuf*|*.json) continue ;; esac
  [ -f "$f.cosign.sig" ] || { ci_error "unsigned artifact: $f"; rc=1; }
done
exit $rc
