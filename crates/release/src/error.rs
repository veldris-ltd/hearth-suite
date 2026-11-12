//! Errors raised while parsing or verifying release metadata.

/// A release-verification error.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The metadata could not be (de)serialized as JSON.
    #[error("release metadata json error: {0}")]
    Json(#[from] serde_json::Error),

    /// A signature field was not valid base64.
    #[error("signature decode error: {0}")]
    Signature(String),

    /// No signature from a pinned trusted root verified over the metadata.
    #[error("no trusted signature on release metadata")]
    Untrusted,

    /// The requested target is not listed in the verified metadata.
    #[error("unknown release target: {0}")]
    UnknownTarget(String),

    /// A downloaded artifact's hash did not match the signed metadata.
    #[error("hash mismatch for target: {0}")]
    HashMismatch(String),

    /// A downloaded artifact's length did not match the signed metadata.
    #[error("length mismatch for {name}: expected {expected} bytes, got {actual}")]
    LengthMismatch {
        /// Target name.
        name: String,
        /// Length recorded in the signed metadata.
        expected: u64,
        /// Length of the bytes actually presented.
        actual: u64,
    },

    /// The offered version is not strictly newer than the installed one.
    #[error("rollback rejected: offered version {offered} is not newer than installed {current}")]
    Rollback {
        /// The currently-installed version.
        current: u32,
        /// The version offered by the update.
        offered: u32,
    },
}

/// Result alias for release operations.
pub type Result<T> = std::result::Result<T, Error>;
