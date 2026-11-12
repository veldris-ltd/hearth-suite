//! Error type for Bundle I/O.

use std::io;

/// Errors that can occur while reading, writing, or verifying a Bundle.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// An underlying I/O failure.
    #[error("i/o error: {0}")]
    Io(#[from] io::Error),

    /// The ZIP container could not be read or written.
    #[error("zip container error: {0}")]
    Zip(#[from] zip::result::ZipError),

    /// The manifest JSON could not be (de)serialized.
    #[error("manifest serialization error: {0}")]
    Json(#[from] serde_json::Error),

    /// A part referenced by the manifest was missing from the container.
    #[error("missing part: {0}")]
    MissingPart(String),

    /// A content integrity check failed (a stored part did not match its hash).
    #[error("integrity check failed for {path}: expected {expected}, got {actual}")]
    Integrity {
        /// The container path of the offending part.
        path: String,
        /// The hash recorded in the manifest.
        expected: String,
        /// The hash recomputed from the stored bytes.
        actual: String,
    },

    /// Manifest signature verification failed.
    #[error("signature verification failed: {0}")]
    Signature(String),
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
