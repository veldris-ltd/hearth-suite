//! Key manager and identity for Hearth Suite.
//!
//! Owns the lifecycle of a user's post-quantum identity, built on the
//! [`hearth_seal`] primitives:
//!
//! - [`create`] a new identity with a 32-byte master seed, returning a
//!   BIP-39 [`RecoveryPhrase`] and an at-rest [`EncryptedIdentity`].
//! - [`unlock`] a stored identity with a passphrase; the master seed is
//!   encrypted at rest and never written in plaintext (`AC-SEC-8`).
//! - [`restore`] from the recovery phrase on a clean install (`AC-SEC-7`).
//! - [`rotate`] to a new key epoch while staying recoverable from the phrase.
//! - exchange recipient public keys via a [`ContactCard`] (QR / contact card /
//!   optional key directory), with no key handling required of the user
//!   (`AC-SEC-9`, `AC-UX-SEAL-1`).
//! - pair additional [`Device`]s under one identity.
//!
//! Implemented for P1.5.

pub mod contact;
pub mod error;
pub mod keystore;
pub mod pairing;
pub mod recovery;

pub use contact::ContactCard;
pub use error::{Error, Result};
pub use keystore::{create, restore, rotate, unlock, EncryptedIdentity, UnlockedIdentity};
pub use pairing::{Device, PairingCode};
pub use recovery::RecoveryPhrase;
