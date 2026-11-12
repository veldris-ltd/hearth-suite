//! Error type for the local store.

use std::io;

/// Errors that can occur in the store and vault.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// An underlying I/O failure.
    #[error("i/o error: {0}")]
    Io(#[from] io::Error),

    /// A SQLite error.
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// JSON (de)serialization of Records values failed.
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),

    /// A ZIP backup archive could not be read or written.
    #[error("backup archive error: {0}")]
    Zip(#[from] zip::result::ZipError),

    /// Encryption or decryption of vault content failed.
    #[error("vault crypto error: {0}")]
    Crypto(String),

    /// A referenced entity was not found.
    #[error("not found: {0}")]
    NotFound(String),

    /// The store or backup was structurally invalid.
    #[error("invalid store: {0}")]
    Invalid(String),
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
