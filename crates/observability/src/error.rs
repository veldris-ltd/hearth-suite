//! Observability errors.

/// An observability error.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A log payload contained a field that may hold a secret or user content.
    #[error("log payload may expose secret or user content via field {0:?}")]
    UnsafeLogField(String),

    /// A JSON (de)serialization error.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Result alias for observability operations.
pub type Result<T> = std::result::Result<T, Error>;
