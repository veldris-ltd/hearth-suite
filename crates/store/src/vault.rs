//! The encrypted document vault.
//!
//! Document content lives only in the vault, encrypted at rest with
//! XChaCha20-Poly1305 under a key derived from the user identity (`AC-STO-2`).
//! The SQLite metadata database never holds document bodies (`AC-DATA-1`).
//!
//! The cipher is abstracted behind [`VaultCipher`] so the post-quantum `seal`
//! crate can supply the AEAD in P1.4 without changing the store layout. The
//! default [`IdentityCipher`] derives a 256-bit key from the identity secret
//! with HKDF-SHA256, vetted primitives only, no bespoke crypto.

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;

use crate::error::{Error, Result};

/// Length of the XChaCha20-Poly1305 nonce, in bytes.
const NONCE_LEN: usize = 24;
/// HKDF salt that domain-separates the vault key.
const KDF_SALT: &[u8] = b"hearth-vault-v1";
/// HKDF info string for the content-encryption key.
const KDF_INFO: &[u8] = b"hearth-vault-content-key/xchacha20poly1305";

/// Encrypts and decrypts vault content.
///
/// Implementations must be deterministic in algorithm but use a fresh random
/// nonce per [`encrypt`](VaultCipher::encrypt) call.
pub trait VaultCipher: Send + Sync {
    /// Encrypt `plaintext`, returning a self-contained blob (nonce + ciphertext).
    ///
    /// # Errors
    /// Returns an error if encryption or nonce generation fails.
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>>;

    /// Decrypt a blob produced by [`encrypt`](VaultCipher::encrypt).
    ///
    /// # Errors
    /// Returns an error if the blob is malformed or authentication fails (wrong
    /// key or tampered content).
    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>>;
}

/// The default vault cipher: XChaCha20-Poly1305 keyed from the user identity.
pub struct IdentityCipher {
    cipher: XChaCha20Poly1305,
}

impl IdentityCipher {
    /// Derive the vault cipher from the user identity's secret bytes.
    ///
    /// The secret is any high-entropy identity material (in production, supplied
    /// by the `key-manager`); the content key is derived via HKDF-SHA256.
    ///
    /// # Panics
    /// Does not panic in practice: a 32-byte output is always a valid HKDF
    /// length and a valid XChaCha20-Poly1305 key length.
    pub fn from_identity_secret(secret: &[u8]) -> Self {
        let hk = Hkdf::<Sha256>::new(Some(KDF_SALT), secret);
        let mut key = [0u8; 32];
        hk.expand(KDF_INFO, &mut key)
            .expect("32 bytes is a valid HKDF-SHA256 output length");
        let cipher = XChaCha20Poly1305::new_from_slice(&key)
            .expect("32 bytes is a valid XChaCha20-Poly1305 key length");
        Self { cipher }
    }
}

impl VaultCipher for IdentityCipher {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::fill(&mut nonce_bytes).map_err(|e| Error::Crypto(e.to_string()))?;
        let nonce = XNonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| Error::Crypto(e.to_string()))?;
        let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);
        Ok(blob)
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>> {
        if blob.len() < NONCE_LEN {
            return Err(Error::Crypto("vault blob too short".to_owned()));
        }
        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
        let nonce = XNonce::from_slice(nonce_bytes);
        self.cipher.decrypt(nonce, ciphertext).map_err(|_| {
            Error::Crypto("decryption failed (wrong key or tampered content)".to_owned())
        })
    }
}
