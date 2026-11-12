# Cryptography review record (AC-SEC-12)

This is the standing record of the cryptography review for the package scoped in
[`README.md`](./README.md). It captures what has been verified in-repo, the
formal acceptance of the one release-candidate dependency, and the status of the
external third-party engagement.

> **Honesty note.** This document records an **internal cryptographic
> self-review** plus the in-repo test evidence. It is *not* a third-party report
> and does not claim one. The independent external review is the remaining
> pre-GA step (this item is P1, pre-GA, not a v1.0-launch blocker); the external
> firm's report and any additional vectors will be committed alongside this file
> under `docs/security/crypto-audit-package/` when the engagement completes.

## Status summary

| Item | Status |
| ---- | ------ |
| Scope frozen, package buildable & reproducible | Done (see README) |
| In-repo known-answer vectors + harness | Done (`crates/seal/tests/vectors/`) |
| `slh-dsa` release-candidate dependency | **Formally accepted** (below) |
| Constant-time (no Hearth-side secret-dependent branches) | Confirmed (below) |
| Internal self-review | Done (this record) |
| Independent external review report | Pre-GA, to be filed here |

## Methodology (internal self-review)

- Confirmed `crates/seal/src/crypto.rs` is the **only** call site for primitives
  (no hand-rolled crypto; AC-SEC-6): every other module calls the typed `seal`
  API, never a primitive directly.
- Re-derived each primitive's standard and library mapping against the table in
  the README (FIPS 203 / 204 / 205, RFC 7748 / 5869 / 9106, SP 800-38D).
- Ran the known-answer, tamper, hybrid-KEK, and lifecycle tests
  (`cargo test -p hearth-seal -p hearth-key-manager`) and the new file-driven
  vector harness.
- Reviewed the hybrid construction (`derive_kek`): the content key stays
  confidential if *either* X25519 or ML-KEM-768 is later broken.

## Findings and resolutions

The README's "Known limitations / questions for reviewers" are resolved as
follows:

1. **ACVP vector coverage.** A reviewable known-answer vector set is now checked
   in at `crates/seal/tests/vectors/kat-vectors.json` with a harness
   (`kat_vectors_file_matches_implementation`) that verifies the implementation
   against it. These are deterministic regression vectors; the authoritative NIST
   ACVP suites run in the upstream RustCrypto crate CI (documented in the
   vectors `README.md`). **Resolved.**
2. **`slh-dsa` is a release candidate.** Formally accepted, see below.
3. **Constant-time guarantees.** Confirmed: Hearth-side code introduces no
   secret-dependent branches; all primitive operations are delegated to the
   upstream libraries, whose constant-time properties are inherited. AEAD open
   fails closed on tampering (`aead_open`), and signature verification is a pure
   boolean with no early-out on secret data. **Confirmed.**

## Formal acceptance: `slh-dsa = 0.2.0-rc.5`

**Decision:** the release-candidate `slh-dsa` dependency is **accepted** for
v1.0, with a re-review trigger on its stable release.

**Rationale:**

- **No stable release exists upstream.** As of this record, RustCrypto has not
  published a stable `slh-dsa`; `0.2.0-rc.5` is the current release candidate
  and the maintained FIPS 205 (SLH-DSA / SHAKE-128f) implementation in the
  ecosystem. "Resolve to stable" is therefore not yet possible.
- **Limited, non-default blast radius.** SLH-DSA is used **only** for the
  *archival* signature option (`crates/seal/src/archival.rs`). The primary,
  always-on signature path, Bundle manifests and release metadata, is
  **ML-DSA-65** (`ml-dsa`, a stable `0.1` release), which is not affected by this
  acceptance.
- **Pinned and reproducible.** The exact version is pinned in `Cargo.toml` and
  locked in `Cargo.lock`; the SBOM records the full transitive graph. A change
  in behaviour is caught by the archival sign/verify test.
- **Hash-based, conservative primitive.** SLH-DSA is a stateless hash-based
  signature scheme standardised in FIPS 205; the RC tracks the final standard.

**Re-review trigger:** when a stable `slh-dsa` is published, upgrade and re-run
this review (add a deterministic SLH-DSA vector to the harness once the stable
API exposes seeded key generation). Tracked as a follow-up; the dependency
comment in `crates/seal/Cargo.toml` points here.

**Accepted by:** Hearth Suite maintainers, 2026-06-09.

## External review (pre-GA)

The package is frozen and reproducible from the public repository (build/test
commands in the README). The independent external cryptographic review is
scheduled before general availability; its report and any supplied test vectors
will be committed under `docs/security/crypto-audit-package/`. Until then, the
evidence above constitutes the in-repo substantiation, and AC-SEC-12 is
**closed for the v1.0 open-source launch** with the external report tracked as a
pre-GA deliverable.
