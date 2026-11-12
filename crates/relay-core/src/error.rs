//! Sync-relay domain errors.

/// A relay domain error.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// A per-account quota would be exceeded by the write.
    #[error("quota exceeded: {0}")]
    QuotaExceeded(String),

    /// The account is sending too fast.
    #[error("rate limited")]
    RateLimited,

    /// The referenced blob does not exist.
    #[error("blob not found")]
    NotFound,

    /// The blob metadata was malformed (e.g. zero size).
    #[error("invalid blob: {0}")]
    InvalidBlob(String),
}

/// Result alias for relay operations.
pub type Result<T> = std::result::Result<T, Error>;
