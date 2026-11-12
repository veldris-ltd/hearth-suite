//! Error type for the CRDT sync engine.

/// Errors that can occur encoding, decrypting, or merging deltas.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A delta could not be (de)serialized.
    #[error("delta encoding error: {0}")]
    Encoding(#[from] serde_json::Error),

    /// Encryption or decryption of a delta failed.
    #[error("delta crypto error: {0}")]
    Crypto(String),
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
