//! Manifest signing and verification.
//!
//! The Bundle format binds its manifest with a detached signature so tampering
//! is detectable (`AC-BND-2`). The algorithm is abstracted behind [`Signer`] and
//! [`Verifier`] so the post-quantum `seal` crate can supply ML-DSA signing in
//! P1.4 without changing the container format.
//!
//! [`HmacSigner`]/[`HmacVerifier`] are the interim symmetric implementation used
//! by the CLI and tests. They provide integrity binding but **not** the
//! asymmetric, post-quantum signatures that sealed Bundles will require.

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Produces a detached signature over a manifest's canonical bytes.
pub trait Signer {
    /// The algorithm identifier recorded in the [`Signature`](crate::manifest::Signature).
    fn algorithm(&self) -> &str;
    /// The identifier of the signing key.
    fn key_id(&self) -> &str;
    /// Sign the given message, returning the raw signature bytes.
    fn sign(&self, message: &[u8]) -> Vec<u8>;
}

/// Verifies a detached signature produced by a [`Signer`].
pub trait Verifier {
    /// Verify `signature` over `message` for the given key and algorithm.
    ///
    /// Implementations must return `false` (never panic) on any mismatch,
    /// unknown key, or unsupported algorithm.
    fn verify(&self, key_id: &str, algorithm: &str, message: &[u8], signature: &[u8]) -> bool;
}

/// The algorithm identifier used by [`HmacSigner`].
pub const HMAC_SHA256: &str = "hmac-sha256";

/// Interim HMAC-SHA256 signer (superseded by ML-DSA in P1.4).
#[derive(Clone)]
pub struct HmacSigner {
    key_id: String,
    key: Vec<u8>,
}

impl HmacSigner {
    /// Create a signer from a key identifier and secret key bytes.
    pub fn new(key_id: impl Into<String>, key: impl Into<Vec<u8>>) -> Self {
        Self {
            key_id: key_id.into(),
            key: key.into(),
        }
    }
}

impl Signer for HmacSigner {
    fn algorithm(&self) -> &str {
        HMAC_SHA256
    }

    fn key_id(&self) -> &str {
        &self.key_id
    }

    fn sign(&self, message: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("HMAC accepts any key length");
        mac.update(message);
        mac.finalize().into_bytes().to_vec()
    }
}

/// Interim HMAC-SHA256 verifier paired with [`HmacSigner`].
#[derive(Clone)]
pub struct HmacVerifier {
    key_id: String,
    key: Vec<u8>,
}

impl HmacVerifier {
    /// Create a verifier from the key identifier and secret key bytes.
    pub fn new(key_id: impl Into<String>, key: impl Into<Vec<u8>>) -> Self {
        Self {
            key_id: key_id.into(),
            key: key.into(),
        }
    }
}

impl Verifier for HmacVerifier {
    fn verify(&self, key_id: &str, algorithm: &str, message: &[u8], signature: &[u8]) -> bool {
        if key_id != self.key_id || algorithm != HMAC_SHA256 {
            return false;
        }
        let Ok(mut mac) = HmacSha256::new_from_slice(&self.key) else {
            return false;
        };
        mac.update(message);
        mac.verify_slice(signature).is_ok()
    }
}
