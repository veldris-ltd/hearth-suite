//! Key-directory domain errors.

/// A key-directory error.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The submitted bytes are not a valid public identity (so they could not be
    /// stored, e.g. they are malformed, or are not public-key material).
    #[error("invalid public key: {0}")]
    InvalidPublicKey(String),

    /// The requested key id is not in the directory.
    #[error("key not found")]
    NotFound,

    /// The transparency log failed verification at the given sequence.
    #[error("transparency log tampering detected at sequence {0}")]
    LogTampered(u64),
}

/// Result alias for key-directory operations.
pub type Result<T> = std::result::Result<T, Error>;
