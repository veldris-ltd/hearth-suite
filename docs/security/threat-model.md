# Hearth Suite threat model (STRIDE)

This is the public threat model for Hearth Suite, derived from the data-flow diagram
`docs/build/diagrams/10_threat_dfd.mmd`. It enumerates the trust boundaries and
data flows, applies **STRIDE** (Spoofing, Tampering, Repudiation, Information
disclosure, Denial of service, Elevation of privilege) to each, and maps every
threat to a mitigation that **references code**. (Satisfies AC-SEC-10.)

> Default posture: Hearth Suite is offline-first and local-only. The cloud services are
> optional, self-hostable, and zero-knowledge. The strongest guarantee is that
> **user document content never leaves the device in cleartext** and is never
> visible to any server or operator.

## Trust boundaries (from diagram 10)

| # | Boundary | Trust | Contents |
| - | -------- | ----- | -------- |
| TB1 | **User Device (primary)** | trusted | UI shell, Hearth Suite Core, encrypted vault + SQLite, Ember runtime |
| TB2 | **Network** | untrusted | TLS 1.3 channel |
| TB3 | **Veldris Cloud (optional)** | semi-trusted | Sync Relay (zero-knowledge), Key Directory, encrypted object store, Admin Control Panel |

## Data flows

- DF1 user → UI shell (local input)
- DF2 UI shell → Core (`crates/ffi`, `call_json` / `hearth_call`)
- DF3 Core → vault (`crates/store`, encrypted at rest)
- DF4 Core → Ember (`crates/ember-bridge`, on-device only)
- DF5 Core → TLS → Relay (**encrypted blobs only**, `crates/crdt-sync`)
- DF6 Core → TLS → Key Directory (fetch public keys)
- DF7 Relay → object store (opaque ciphertext)
- DF8 Operator → Admin Control Panel (`services/admin-cp`, `crates/admin-core`)

---

## STRIDE by element

### DF2, UI shell ↔ Core (the FFI boundary)

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Tampering | Malformed request crashes the core across the C-ABI | All input is JSON validated by `serde` before dispatch; unknown methods return an error, never panic, `crates/ffi/src/cabi.rs` (`dispatch`, `call_json`). |
| Information disclosure | Plaintext leaks through the boundary | The boundary carries base64 of already-encrypted/in-memory content; no plaintext is persisted by the boundary itself, `crates/ffi/src/core.rs`. |
| DoS | Pathological input exhausts memory | Bundle/parser inputs are size-checked and fuzzed (see DF3); the C-ABI frees every allocation, `hearth_string_free` in `crates/ffi/src/cabi.rs`. |

### DF3, Core ↔ vault (data at rest)

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Information disclosure | Disk theft exposes documents | Documents are encrypted before they reach SQLite; the metadata DB stores no plaintext content, `crates/store`. |
| Tampering | On-disk ciphertext is altered | AEAD (AES-256-GCM) detects any modification on decrypt, `crates/seal/src/crypto.rs` (`aead_open`); covered by `aead_detects_tampering`. |
| Tampering | A corrupt/hostile Bundle archive crashes the parser | `Bundle::read` returns an error on malformed zip/manifest input and is fuzzed, `crates/bundle` + `crates/bundle/tests/fuzz_robustness.rs`, `fuzz/fuzz_targets/bundle_read.rs` (AC-SEC-11). |

### DF4, Core ↔ Ember (on-device AI)

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Information disclosure | Document content is sent to a cloud model | Ember has **no network path**: the crate links no networking dependency and every generation is device-local, `crates/ember-bridge/src/backend.rs`, enforced by `crates/ember-bridge/tests/zero_egress.rs` (AC-QA-3). |

### DF5–DF7, Sync relay (zero-knowledge) and object store

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Information disclosure | The relay/operator reads synced content | Only sealed deltas (ciphertext) are sent; the relay stores opaque blobs and admin metadata carries no content, `crates/crdt-sync` (`seal_delta`/`merge_sealed_delta`), `crates/admin-core/src/relay.rs` (`BlobMeta` has no content field; test `blob_metadata_has_no_content_field`). |
| Tampering | A blob is altered in transit/at rest | Deltas are authenticated; decrypt fails on tampering, `crates/seal` AEAD. TLS 1.3 protects the channel (TB2). |
| Spoofing | A forged delta is injected | Content is sealed/authenticated per recipient; only grant-holders can unseal, `crates/seal/src/seal.rs` (`unseal`, `Error::NotRecipient`). |
| DoS | A client floods the relay | Quotas reject over-limit writes gracefully, `crates/admin-core/src/relay.rs` (`admit`, `Error::QuotaExceeded`). |

### DF6, Key Directory (public-key publication)

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Spoofing | A substituted public key enables impersonation | Keys are published to an **append-only transparency log** with hash-chained inclusion proofs, `crates/admin-core/src/keydir.rs` (`TransparencyLog`, `verify_log`, `verify_inclusion`). |
| Tampering | The directory rewrites history | Any rewrite breaks the hash chain (tested: `tampering_breaks_the_log`). |
| Repudiation | A key change is denied | Every publish/revoke is a logged, ordered event, `keydir.rs`. |

### DF8, Admin Control Panel

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Spoofing | Operator impersonation | WebAuthn (hardware-backed) sign-in, `services/admin-cp/api/src/auth.rs` (AC-ADMIN-3). |
| Elevation of privilege | An operator exceeds their role | Least-privilege RBAC checked on every action; new operators default to read-only, `crates/admin-core/src/rbac.rs` (`can`, `default_role`). |
| Repudiation | An operator denies an action | Append-only, hash-chained, signable audit log of every attempt (allowed or denied), `crates/admin-core/src/audit.rs` (`AuditLog`, `verify_chain`, `sign_head`). |
| Information disclosure | The panel exposes user content | Relay/telemetry types carry only ids/counts/hashes; a redaction guard rejects any content-bearing field, server- and client-side, `crates/admin-core/src/telemetry.rs` (`assert_aggregate_only`), `apps/admin/src/core.mjs` (`assertNoUserContent`). |

### Release & update channel

| STRIDE | Threat | Mitigation (code) |
| ------ | ------ | ----------------- |
| Tampering | A malicious update is installed | The client verifies the TUF metadata **signature against pinned roots** and the artifact **hash + length** before install; fails closed, `crates/release` (`ReleaseMetadata::verify`, `VerifiedTargets::verify_artifact`), `apps/desktop/src-tauri/src/updater.rs` (AC-DESK-3). |
| Spoofing | A forged release is published | Releases are signed with post-quantum ML-DSA role keys, `crates/seal/src/signing.rs`; CI additionally cosign-signs every artifact and rejects unsigned ones (AC-CI-3). |
| Tampering | Non-reproducible builds hide a backdoor | CI verifies bit-for-bit reproducibility, `.github/workflows/ci.yml` (`reproducible-build`, AC-CI-4). |

## Cryptography (summary)

All cryptography lives in `crates/seal` and uses vetted, audited libraries, no
hand-rolled primitives (AC-SEC-6). Hybrid key establishment (X25519 + ML-KEM-768,
FIPS 203) keeps the content key secret if *either* primitive is later broken;
signatures use ML-DSA-65 (FIPS 204) with SLH-DSA (FIPS 205) for archival; content
uses AES-256-GCM. See `docs/security/crypto-audit-package/` for the full
third-party review package.

## Residual risks & assumptions

- A fully compromised device (malware with the user's unlocked session) is out of
  scope; Hearth Suite protects data at rest, in transit, and from the cloud, not from a
  compromised local OS.
- The optional cloud is *semi-trusted*: it can observe metadata (blob sizes,
  timing, IP) but never content. Self-hosting removes even that exposure.
- The pinned release root key and key-directory operation keys must be protected
  by the operator; their compromise is mitigated by signing, transparency logs,
  and reproducible builds, but not eliminated.
