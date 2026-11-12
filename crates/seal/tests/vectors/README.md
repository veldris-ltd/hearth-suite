# Cryptography test vectors

Checked-in known-answer vectors for the Hearth Suite cryptography review
(P2-Q3 / AC-SEC-12). The harness `kat_vectors_file_matches_implementation` in
`crates/seal/src/crypto.rs` (`mod kat`) loads `kat-vectors.json` and verifies the
in-scope implementation against every entry, so the vectors are the reviewable
source of truth and any behaviour change fails CI.

## Provenance and scope

These are **deterministic regression vectors** produced by Hearth Suite's own in-scope
implementation (the RustCrypto FIPS primitives wrapped in `crypto.rs`):

- **ML-KEM-768 (FIPS 203):** key generation from a fixed 64-byte seed, and
  deterministic encapsulation from fixed 32-byte coins. The encapsulation key,
  ciphertext, and shared secret are pinned.
- **ML-DSA-65 (FIPS 204):** key generation from a fixed 32-byte seed, with the
  verifying key pinned by SHA-256.

They guarantee the implementation does not silently change, and they give a
reviewer a self-contained, runnable artifact.

They are **not** a substitute for the authoritative NIST **ACVP** vector suites.
Those large official suites are exercised in the upstream RustCrypto crate CI
(`ml-kem`, `ml-dsa`, `slh-dsa`), which is where primitive conformance is proven.
When Hearth Suite pins a stable `slh-dsa` (see
`docs/security/crypto-audit-package/review-record.md`), an SLH-DSA / SHAKE-128f
deterministic vector will be added here too; the RC API does not expose
seeded key generation, so only a sign/verify property test covers it today.
