//! Error type for the key manager.

/// Errors that can occur managing identities, keystores, and pairing.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// An error from the underlying Seal crypto.
    #[error("seal error: {0}")]
    Seal(#[from] hearth_seal::Error),

    /// The recovery phrase was malformed or the wrong length.
    #[error("recovery phrase error: {0}")]
    Phrase(String),

    /// At-rest encryption or key derivation failed.
    #[error("keystore crypto error: {0}")]
    Crypto(String),

    /// The keystore could not be unlocked (wrong passphrase or tampered).
    #[error("keystore unlock failed (wrong passphrase or corrupted keystore)")]
    Unlock,

    /// A contact card / key payload was malformed.
    #[error("invalid contact card: {0}")]
    Contact(String),
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
