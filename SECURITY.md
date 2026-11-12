# Security Policy

Hearth Suite handles people's private documents and encryption keys on their own devices. We take
security and privacy seriously and welcome responsible disclosure.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions,
or pull requests.**

Instead, report privately through one of:

- GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email **hello@veldris.io** with the details below.

Please include, where possible:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected component(s), version, commit, and platform.
- Any suggested remediation.

## What to expect

- **Acknowledgement** within 3 business days.
- An initial **assessment** (severity and validity) within 10 business days.
- Coordinated disclosure: we will agree a timeline with you and credit you in the advisory
  unless you prefer to remain anonymous.

Please give us reasonable time to investigate and ship a fix before any public disclosure.

## Scope

In scope: the Hearth Suite core (Rust crates), clients, the Seal cryptography, the local store and
vault, and the optional self-hostable services (sync relay, key directory, release service,
admin console).

## Cryptography

All cryptography lives in the `seal` crate and uses vetted, audited libraries, no
hand-rolled primitives. Hearth Suite uses a hybrid post-quantum scheme (X25519 + ML-KEM /
FIPS 203, ML-DSA / FIPS 204 signatures, AES-256-GCM / XChaCha20-Poly1305 content). A
third-party cryptographic audit is planned before the first release. Reports about
cryptographic design or implementation are especially welcome. The review package
for the `seal`/`key-manager` crates is in
[`docs/security/crypto-audit-package/`](docs/security/crypto-audit-package/README.md).

## Security model

Hearth Suite is offline-first and local-only by default; the cloud services are optional,
self-hostable, and zero-knowledge. The core guarantees:

- **Content never leaves the device in cleartext.** Sync sends only sealed
  (encrypted, authenticated) blobs; the relay and any operator see opaque
  ciphertext and metadata, never document content.
- **On-device AI has no network path.** The Ember runtime links no networking
  dependency; this is enforced by a zero-egress test in CI.
- **Data at rest is encrypted** in the vault; tampering is detected by AEAD.
- **Updates are verified before install** against pinned post-quantum signing
  roots (signature + hash), and release builds are reproducible.
- **Operators run under least privilege** with an append-only, tamper-evident
  audit log and hardware-backed (WebAuthn) authentication.

The full **STRIDE threat model**, derived from the system data-flow diagram and
mapping every threat to a code-level mitigation, is published at
[`docs/security/threat-model.md`](docs/security/threat-model.md).

## Supply chain

- Every dependency is gated by `cargo deny` (licences, advisories, sources) and
  `cargo audit`/`osv-scanner`/`pnpm audit` in CI; HIGH/CRITICAL advisories fail
  the build.
- A **CycloneDX SBOM** is generated for each build.
- Release artifacts are **signed** (cosign keyless) and carry **SLSA build
  provenance attestations**; unsigned artifacts are rejected.
- Parsers that consume untrusted input (Bundle, ODF/OOXML, legacy Works) are
  fuzzed in CI.

## Safe harbour

We will not pursue or support legal action against researchers who act in good faith, avoid
privacy violations and data destruction, and give us a reasonable opportunity to respond
before disclosing.
