# Hearth Suite cryptography audit package

This package scopes Hearth Suite's cryptography for **third-party cryptographic review**
(AC-SEC-12). Everything here is buildable, documented, and reproducible from the
public repository.

## Scope

The review covers exactly three crates, Hearth Suite's entire cryptographic surface:

| Crate | Path | Responsibility |
| ----- | ---- | -------------- |
| `hearth-seal` | `crates/seal` | The Seal: hybrid PQ key establishment, signatures, AEAD content, detached release signatures. **All cryptography lives here.** |
| `hearth-key-manager` | `crates/key-manager` | Identity lifecycle: create/unlock/rotate, recovery phrase (BIP-39), device pairing, contact cards. |
| (crypto module) | `crates/seal/src/crypto.rs` | The single module wrapping the primitive libraries; the only place primitives are called. |

Out of scope (but provided as context): how the rest of the system *uses* these
crates (`crates/store`, `crates/crdt-sync`, `crates/release`, `crates/ffi`).

## Design (what to review)

- **No hand-rolled primitives** (AC-SEC-6). Every primitive comes from a vetted
  RustCrypto / dalek library; `crates/seal/src/crypto.rs` is the only call site.
- **Hybrid key establishment**, X25519 (`x25519-dalek`) **+** ML-KEM-768
  (FIPS 203, `ml-kem`), combined via HKDF-SHA256. The content key stays
  confidential if *either* primitive is later broken (`derive_kek`).
- **Signatures**, ML-DSA-65 (FIPS 204, `ml-dsa`) over the Bundle manifest and
  over release metadata; SLH-DSA / SHAKE-128f (FIPS 205, `slh-dsa`) for archival.
- **Content encryption**, AES-256-GCM (`aes-gcm`); decrypt fails closed on
  tampering. (XChaCha20-Poly1305 is available for large-payload paths.)
- **Key derivation / passwords**, HKDF-SHA256 (`hkdf`), Argon2id (`argon2`) for
  vault unlock; BIP-39 recovery phrases (`bip39`).
- **Randomness**, OS CSPRNG via `getrandom`; no userspace PRNG for key material.

## Primitive → library → standard

| Primitive | Library (version pinned in `Cargo.toml`) | Standard |
| --------- | ---------------------------------------- | -------- |
| X25519 | `x25519-dalek` | RFC 7748 |
| ML-KEM-768 | `ml-kem` | FIPS 203 |
| ML-DSA-65 | `ml-dsa` | FIPS 204 |
| SLH-DSA (SHAKE-128f) | `slh-dsa` | FIPS 205 |
| AES-256-GCM | `aes-gcm` | NIST SP 800-38D |
| HKDF-SHA256 | `hkdf` + `sha2` | RFC 5869 |
| Argon2id | `argon2` | RFC 9106 |
| BIP-39 | `bip39` | BIP-39 |

Exact versions and the full transitive graph are in `Cargo.lock` and the
CycloneDX SBOM produced by CI (`sbom.cyclonedx.json`).

## Build & test (reproducible)

```sh
# Build just the in-scope crates.
cargo build -p hearth-seal -p hearth-key-manager

# Run the crypto known-answer tests, tamper tests, and unit tests.
cargo test -p hearth-seal -p hearth-key-manager

# Whole-workspace gate (lint with clippy -D warnings, all tests).
just lint && just test
```

## Test evidence to review

- **Known-answer tests (KATs)**, pinned FIPS vectors for ML-KEM, ML-DSA, and
  SLH-DSA, plus AEAD tamper detection and hybrid-KEK dependence:
  `crates/seal/src/crypto.rs` (`mod kat`).
- **Checked-in vector harness**, `crates/seal/tests/vectors/` holds the
  reviewable vectors (`kat-vectors.json` + provenance `README.md`); the
  `kat_vectors_file_matches_implementation` test verifies the implementation
  against the file so any drift fails CI.
- **Seal tamper detection**, manifest/content/grant tampering all fail:
  `crates/seal/tests/seal.rs`.
- **Detached release signatures**, `crates/seal/src/signing.rs` tests.
- **Identity lifecycle**, create/unlock/rotate/recovery:
  `crates/key-manager/tests/keymanager.rs`.
- Upstream RustCrypto crates run the full NIST/ACVP suites in their own CI;
  authoritative ACVP vector files can be dropped into a `tests/vectors/` harness.

## Threat model

The cryptography-relevant subset of the system threat model is in
`docs/security/threat-model.md` (STRIDE). Key crypto assumptions:

- The OS CSPRNG is sound and the device is not already compromised.
- The hybrid construction is secure if **either** the classical or the
  post-quantum component is unbroken.
- Recovery phrases and role/operation keys are protected by the user/operator;
  loss or compromise is out of scope for the primitives themselves.

## Review status

The standing review record, internal self-review findings, the formal
release-candidate acceptance, and the external-engagement status, is in
[`review-record.md`](./review-record.md). Summary of the previously open items:

- **ACVP vector coverage**, a checked-in vector harness now exists
  (`crates/seal/tests/vectors/`); authoritative ACVP suites run upstream.
  **Resolved.**
- **`slh-dsa` release candidate (`0.2.0-rc.5`)**, no stable upstream exists;
  used only for the archival signature option (primary path is ML-DSA-65).
  **Formally accepted**, with a re-review-on-stable trigger (see the record).
- **Constant-time**, confirmed no Hearth-side secret-dependent branches;
  guarantees inherited from the upstream libraries. **Confirmed.**

The independent external review is a pre-GA deliverable; its report will be
committed alongside this package.
