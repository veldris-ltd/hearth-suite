//! Error type for the Seal crate.

/// Errors that can occur while sealing, unsealing, or verifying.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A cryptographic operation failed (encryption, decryption, KDF, RNG).
    #[error("crypto error: {0}")]
    Crypto(String),

    /// Key or ciphertext bytes were the wrong length or otherwise invalid.
    #[error("invalid key material: {0}")]
    InvalidKey(String),

    /// The identity is not a recipient of this sealed bundle.
    #[error("identity is not a recipient of this bundle")]
    NotRecipient,

    /// Signature verification failed (wrong key or tampered manifest).
    #[error("signature verification failed")]
    VerificationFailed,
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
