//! Error type for the Ember bridge.

/// Errors that can occur orchestrating local inference.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The inference backend failed.
    #[error("inference backend error: {0}")]
    Backend(String),

    /// A model or runtime resource was unavailable.
    #[error("model unavailable: {0}")]
    ModelUnavailable(String),
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
