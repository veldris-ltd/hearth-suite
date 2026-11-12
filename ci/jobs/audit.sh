#!/usr/bin/env bash
# Supply-chain gate (AC-CI-2, AC-FND-2): advisories, licences, sources, and a
# CycloneDX SBOM. Fails on any Rust advisory or a HIGH/CRITICAL npm advisory.
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/../lib.sh"
cd "$CI_ROOT" || exit 1
ci_pnpm_install
for tool in cargo-audit cargo-deny; do
  command -v "$tool" >/dev/null 2>&1 || cargo install "$tool" --locked
done
ci_group "cargo audit"; cargo audit --deny warnings; ci_endgroup
ci_group "cargo deny";  cargo deny check; ci_endgroup
ci_group "pnpm audit";  pnpm audit --audit-level=high; ci_endgroup
if command -v osv-scanner >/dev/null 2>&1; then
  ci_group "osv-scanner"; osv-scanner scan --recursive --skip-git ./ ; ci_endgroup
else
  ci_notice "osv-scanner not on PATH (GitHub runs it as an action step)"
fi
mkdir -p dist
if command -v syft >/dev/null 2>&1; then
  ci_group "SBOM (syft, CycloneDX)"
  syft scan dir:. -o cyclonedx-json=dist/sbom.cyclonedx.json
  ci_endgroup
else
  ci_notice "syft not on PATH (GitHub generates the SBOM with anchore/sbom-action)"
fi
