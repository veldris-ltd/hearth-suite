# Test automation & coverage gates (P4.1)

The full test pyramid and the gates that enforce it, satisfying AC-QA-1..4.

## The pyramid (AC-QA-1)

| Tier            | Where                                                              | Runs in |
| --------------- | ----------------------------------------------------------------- | ------- |
| **Unit (Rust)** | `#[test]` in every crate (`rbac`, `audit`, `relay`, `seal`, …)     | `cargo test` |
| **Unit (TS)**   | `node:test` over each module's `core.mjs`                          | `pnpm test` |
| **Integration** | `crates/ffi/tests/bindings.rs`, the full FFI/C-ABI surface        | `cargo test` |
| **Property**    | CRDT convergence (`crdt-sync`), ODF/OOXML round-trip (`odf-io`)     | `cargo test` |
| **Fuzz**        | proptest robustness (`*/tests/fuzz_robustness.rs`) + cargo-fuzz (`fuzz/`) | `cargo test` + CI `fuzz` job |
| **E2E**         | `crates/ffi/tests/e2e_journey.rs` (core) + `apps/e2e` (client flow) | `cargo test` + `pnpm e2e` |

## Primary E2E journey (AC-QA-4)

`crates/ffi/tests/e2e_journey.rs` drives the **real `HearthCore`**, the shared
core every packaged client runs, through *create → edit → Ember → Seal → reopen*
with an in-memory inference backend and **no network** (the crate links no
networking dependency, so there is no egress path at all). `apps/e2e` mirrors the
client-side flow (mail-merge edit → Ember request → Seal status → ODF
export/reopen → universal search) with `globalThis.fetch` hard-disabled.

## Security tests in CI (AC-QA-3)

- **Crypto KATs**, `crates/seal/src/crypto.rs` (FIPS 203/204/205 known-answer).
- **Ember zero-egress**, `crates/ember-bridge/tests/zero_egress.rs`: no
  networking crate in the lockfile, and document content reaches only the local
  backend (every generation is device-local).
- **Seal tamper detection**, `crates/seal/tests/seal.rs`: tampering with the
  manifest, content, or a grant fails verification/decryption.
- **Parser fuzzing**, proptest "never panics on arbitrary bytes" for the legacy
  Works and ODF/OOXML parsers, plus a bounded cargo-fuzz campaign in the CI
  `fuzz` job over the same targets.

## Coverage gate (AC-QA-2)

The CI `coverage` job fails the build below threshold:

- **Rust**, `cargo llvm-cov --workspace --fail-under-lines 70`.
- **TS**, `c8 --check-coverage --lines 75 --branches 70 --functions 75` over the
  executable module logic (`pnpm run coverage`). Current TS coverage is ~90%
  lines / ~75% branches / ~99% functions.

Run locally with `just coverage`.

## Reproducible build (AC-CI-4)

The `reproducible-build` job builds `hearth-ffi` twice under a pinned
`SOURCE_DATE_EPOCH` + path remapping and asserts the output hashes match,
verifying release artifacts are bit-for-bit reproducible.
