//! Post-quantum Seal for Hearth Suite.
//!
//! The single, auditable home of Hearth Suite's cryptography. Sealing a Bundle uses a
//! hybrid scheme built only on vetted, audited libraries (`AC-SEC-6`):
//!
//! - **Key establishment**, hybrid X25519 + ML-KEM-768 (FIPS 203). The content
//!   key stays confidential if *either* primitive is later broken (`AC-SEC-1`).
//! - **Signatures**, ML-DSA-65 (FIPS 204) over the manifest (`AC-SEC-2`);
//!   SLH-DSA / SHAKE-128f (FIPS 205) offered for archival use ([`archival`]).
//! - **Content**, AES-256-GCM under a per-Bundle content key; decryption fails
//!   on tampering (`AC-SEC-3`).
//!
//! Sealing wraps the content key to each recipient's keys as a [`Grant`]
//! (a `SEAL_GRANT`); only listed recipients can [`unseal`] (`AC-SEC-4`).
//!
//! ```
//! use hearth_seal::{seal, unseal, verify, Identity};
//!
//! let alice = Identity::generate()?;
//! let bob = Identity::generate()?;
//!
//! let sealed = seal(b"manifest", b"secret content", &[bob.public()], &alice)?;
//! verify(&sealed, &alice.public())?;
//! assert_eq!(unseal(&sealed, &bob)?, b"secret content");
//! # Ok::<(), hearth_seal::Error>(())
//! ```

pub mod archival;
pub mod error;
pub mod signing;

mod crypto;
mod identity;
mod seal;

pub use error::{Error, Result};
pub use identity::{Identity, IdentityId, PublicIdentity, SEED_LEN};
pub use seal::{seal, unseal, verify, Grant, SealedBundle};
pub use signing::{ReleaseSigningKey, ReleaseVerifyingKey};
