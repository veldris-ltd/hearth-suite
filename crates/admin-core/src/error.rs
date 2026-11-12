//! Errors raised by the Admin Control Panel domain logic.

/// An admin-domain error.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The role lacks permission for the attempted action (still audited).
    #[error("permission denied: {role} may not perform {action}")]
    Denied {
        /// The acting role.
        role: String,
        /// The attempted action.
        action: String,
    },

    /// The audit log's hash chain or signature does not verify.
    #[error("audit log tampering detected at sequence {0}")]
    AuditTampered(u64),

    /// A relay quota would be exceeded by the operation.
    #[error("relay quota exceeded: {0}")]
    QuotaExceeded(String),

    /// A blob lifecycle transition is not permitted from the current state.
    #[error("invalid blob lifecycle transition: {0}")]
    InvalidTransition(String),

    /// A release could not be promoted (not verified, or wrong source channel).
    #[error("invalid release promotion: {0}")]
    InvalidPromotion(String),

    /// The key-directory transparency log does not verify.
    #[error("key directory tampering detected at sequence {0}")]
    KeyLogTampered(u64),

    /// A telemetry payload contains a field that could carry user content.
    #[error("telemetry payload may expose user content via field {0:?}")]
    ContentLeak(String),

    /// A release-metadata verification error.
    #[error(transparent)]
    Release(#[from] hearth_release::Error),

    /// A JSON (de)serialization error.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Result alias for admin-domain operations.
pub type Result<T> = std::result::Result<T, Error>;
