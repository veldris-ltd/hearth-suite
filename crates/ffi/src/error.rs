//! Error type for the FFI/binding layer.

/// Errors surfaced across the binding boundary.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A store/vault error.
    #[error("store error: {0}")]
    Store(#[from] hearth_store::Error),

    /// A Seal crypto error.
    #[error("seal error: {0}")]
    Seal(#[from] hearth_seal::Error),

    /// A key-manager error (e.g. an invalid recovery phrase).
    #[error("key manager error: {0}")]
    KeyManager(#[from] hearth_key_manager::Error),

    /// An Ember inference error.
    #[error("ember error: {0}")]
    Ember(#[from] hearth_ember_bridge::Error),

    /// A CRDT sync error.
    #[error("sync error: {0}")]
    Sync(#[from] hearth_crdt_sync::Error),

    /// A JSON (de)serialization error.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    /// A base64 decoding error.
    #[error("base64 error: {0}")]
    Base64(String),

    /// An identifier could not be parsed.
    #[error("invalid id: {0}")]
    InvalidId(String),

    /// The request was malformed.
    #[error("invalid request: {0}")]
    InvalidRequest(String),
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
