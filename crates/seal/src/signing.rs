//! Detached signatures for release metadata and other non-Bundle payloads.
//!
//! The Seal envelope ([`crate::seal`]) signs a Bundle manifest as part of a
//! larger structure. Some callers, notably the signed TUF release channel used
//! by the desktop/mobile auto-updater (`hearth-release`) and the Release Service
//! (P3.3), need a plain *detached* signature over arbitrary bytes, with a
//! verifying key that can be pinned in a client binary.
//!
//! This module exposes exactly that, reusing Hearth Suite's post-quantum signature
//! primitive (ML-DSA-65, FIPS 204) so the release channel inherits the same
//! quantum-resistant guarantees as Seal, and so *all* of Hearth Suite's cryptography
//! still lives in this one audited crate (`AC-SEC-6`).
//!
//! ```
//! use hearth_seal::signing::ReleaseSigningKey;
//!
//! let sk = ReleaseSigningKey::from_seed(&[7u8; 32])?;
//! let vk = sk.verifying_key();
//! let sig = sk.sign(b"release metadata");
//! vk.verify(b"release metadata", &sig)?;
//! assert!(vk.verify(b"tampered", &sig).is_err());
//! # Ok::<(), hearth_seal::Error>(())
//! ```

use crate::crypto;
use crate::error::{Error, Result};

use ml_dsa::{MlDsa65, SigningKey, VerifyingKey};

/// A signing key for detached release signatures (ML-DSA-65).
///
/// Held only by signers (CI / the Release Service role keys). Derive it
/// deterministically from a 32-byte role seed so the same key is reconstructible
/// from securely-stored key material.
pub struct ReleaseSigningKey {
    inner: SigningKey<MlDsa65>,
}

impl ReleaseSigningKey {
    /// Deterministically derive a signing key from a 32-byte role seed
    /// (FIPS 204 `KeyGen_internal`).
    ///
    /// # Errors
    /// Returns [`Error::InvalidKey`] if the seed is rejected by the keygen.
    pub fn from_seed(seed: &[u8; 32]) -> Result<Self> {
        Ok(Self {
            inner: crypto::mldsa_keypair_from_seed(seed)?,
        })
    }

    /// The matching public verifying key, safe to pin in clients and publish.
    #[must_use]
    pub fn verifying_key(&self) -> ReleaseVerifyingKey {
        ReleaseVerifyingKey {
            inner: crypto::mldsa_verifying_key(&self.inner),
        }
    }

    /// Sign `message`, returning the detached signature bytes.
    #[must_use]
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        crypto::mldsa_sign(&self.inner, message)
    }
}

/// A public verifying key for detached release signatures (ML-DSA-65).
///
/// This is what a client pins as a TUF root: the bytes are embedded in the
/// shipped binary, so an update can only be trusted if it carries a signature
/// that verifies under one of these keys.
#[derive(Clone)]
pub struct ReleaseVerifyingKey {
    inner: VerifyingKey<MlDsa65>,
}

impl ReleaseVerifyingKey {
    /// Parse a verifying key from its canonical byte encoding.
    ///
    /// # Errors
    /// Returns [`Error::InvalidKey`] if the bytes are not a valid ML-DSA-65
    /// verifying key.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        Ok(Self {
            inner: crypto::mldsa_vk_from_bytes(bytes)?,
        })
    }

    /// The canonical byte encoding of this verifying key.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        crypto::mldsa_vk_to_bytes(&self.inner)
    }

    /// Verify a detached `signature` over `message`.
    ///
    /// # Errors
    /// Returns [`Error::VerificationFailed`] if the signature is invalid for this
    /// key and message (wrong key, wrong message, or malformed signature).
    pub fn verify(&self, message: &[u8], signature: &[u8]) -> Result<()> {
        if crypto::mldsa_verify(&self.inner, message, signature) {
            Ok(())
        } else {
            Err(Error::VerificationFailed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_round_trip() {
        let sk = ReleaseSigningKey::from_seed(&[3u8; 32]).unwrap();
        let vk = sk.verifying_key();
        let sig = sk.sign(b"release metadata v1");
        assert!(vk.verify(b"release metadata v1", &sig).is_ok());
        assert!(vk.verify(b"release metadata v2", &sig).is_err());
    }

    #[test]
    fn deterministic_from_seed() {
        let a = ReleaseSigningKey::from_seed(&[9u8; 32]).unwrap();
        let b = ReleaseSigningKey::from_seed(&[9u8; 32]).unwrap();
        assert_eq!(a.verifying_key().to_bytes(), b.verifying_key().to_bytes());
    }

    #[test]
    fn verifying_key_byte_round_trip() {
        let sk = ReleaseSigningKey::from_seed(&[5u8; 32]).unwrap();
        let vk = sk.verifying_key();
        let parsed = ReleaseVerifyingKey::from_bytes(&vk.to_bytes()).unwrap();
        let sig = sk.sign(b"payload");
        assert!(parsed.verify(b"payload", &sig).is_ok());
    }

    #[test]
    fn wrong_key_rejected() {
        let signer = ReleaseSigningKey::from_seed(&[1u8; 32]).unwrap();
        let other = ReleaseSigningKey::from_seed(&[2u8; 32]).unwrap();
        let sig = signer.sign(b"payload");
        assert!(other.verifying_key().verify(b"payload", &sig).is_err());
    }

    #[test]
    fn malformed_signature_rejected() {
        let sk = ReleaseSigningKey::from_seed(&[4u8; 32]).unwrap();
        assert!(sk.verifying_key().verify(b"payload", b"not-a-sig").is_err());
    }
}
