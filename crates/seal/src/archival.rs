//! Archival signatures with SLH-DSA / SHAKE-128f (FIPS 205).
//!
//! SLH-DSA is offered as an alternative to ML-DSA for long-lived archival
//! signatures: it is conservative (hash-based, relying on minimal assumptions)
//! at the cost of much larger signatures. The default Seal signature is ML-DSA;
//! this module provides the archival option.

use slh_dsa::{Shake128f, SigningKey, VerifyingKey};

use crate::crypto;

/// An SLH-DSA signing keypair for archival signatures.
pub struct ArchivalKey {
    signing: SigningKey<Shake128f>,
}

/// The public half of an [`ArchivalKey`], for verification.
pub struct ArchivalPublicKey {
    verifying: VerifyingKey<Shake128f>,
}

impl ArchivalKey {
    /// Generate a fresh archival signing key.
    pub fn generate() -> Self {
        Self {
            signing: crypto::slhdsa_generate(),
        }
    }

    /// Derive the public verification key.
    pub fn public(&self) -> ArchivalPublicKey {
        ArchivalPublicKey {
            verifying: crypto::slhdsa_verifying_key(&self.signing),
        }
    }

    /// Sign a message, returning the (large) SLH-DSA signature bytes.
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        crypto::slhdsa_sign(&self.signing, message)
    }
}

impl ArchivalPublicKey {
    /// Verify an archival signature over `message`.
    pub fn verify(&self, message: &[u8], signature: &[u8]) -> bool {
        crypto::slhdsa_verify(&self.verifying, message, signature)
    }
}
