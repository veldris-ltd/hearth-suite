//! Optional, encrypted-delta synchronization.
//!
//! Sync is **off by default** ([`SyncConfig::default`]) and the engine never
//! initiates network I/O. When enabled, deltas are encrypted before they leave
//! the device, so a relay only ever stores opaque blobs and cannot recover
//! content or keys (`AC-SYNC-3`). The cipher is abstracted behind [`DeltaCipher`]
//! (the production cipher is keyed from the Bundle's Seal content key).

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use crate::document::Document;
use crate::error::{Error, Result};
use crate::ops::Op;

/// Per-document sync settings. Sync is disabled unless explicitly turned on
/// (`enabled` defaults to `false`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SyncConfig {
    /// Whether opt-in sync is enabled for this document.
    pub enabled: bool,
}

/// Encrypts and decrypts deltas so the relay stays zero-knowledge.
pub trait DeltaCipher {
    /// Encrypt a plaintext delta into an opaque blob.
    ///
    /// # Errors
    /// Returns an error if encryption fails.
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>>;

    /// Decrypt an opaque blob back into a plaintext delta.
    ///
    /// # Errors
    /// Returns an error if decryption or authentication fails.
    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>>;
}

const NONCE_LEN: usize = 24;

/// A [`DeltaCipher`] backed by XChaCha20-Poly1305 under a 256-bit sync key.
pub struct KeyedCipher {
    cipher: XChaCha20Poly1305,
}

impl KeyedCipher {
    /// Create a cipher from a 256-bit sync key.
    ///
    /// # Panics
    /// Does not panic in practice: 32 bytes is always a valid key length.
    pub fn new(key: &[u8; 32]) -> Self {
        let cipher = XChaCha20Poly1305::new_from_slice(key)
            .expect("32 bytes is a valid XChaCha20-Poly1305 key length");
        Self { cipher }
    }
}

impl DeltaCipher for KeyedCipher {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|e| Error::Crypto(e.to_string()))?;
        let ciphertext = self
            .cipher
            .encrypt(XNonce::from_slice(&nonce), plaintext)
            .map_err(|e| Error::Crypto(e.to_string()))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>> {
        if blob.len() < NONCE_LEN {
            return Err(Error::Crypto("delta blob too short".to_owned()));
        }
        let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
        self.cipher
            .decrypt(XNonce::from_slice(nonce), ciphertext)
            .map_err(|_| Error::Crypto("delta authentication failed".to_owned()))
    }
}

/// Encode `ops` and encrypt them into a blob safe to hand to a relay.
///
/// # Errors
/// Returns an error if encoding or encryption fails.
pub fn seal_delta(cipher: &dyn DeltaCipher, ops: &[Op]) -> Result<Vec<u8>> {
    cipher.encrypt(&Document::encode_delta(ops)?)
}

/// Decrypt a relay blob and merge it into `document`.
///
/// # Errors
/// Returns an error if decryption or decoding fails.
pub fn merge_sealed_delta(
    document: &mut Document,
    cipher: &dyn DeltaCipher,
    blob: &[u8],
) -> Result<()> {
    let plaintext = cipher.decrypt(blob)?;
    document.merge_remote_delta(&plaintext)
}
