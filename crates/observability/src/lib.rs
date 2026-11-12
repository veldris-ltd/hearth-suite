//! Privacy-preserving observability for Hearth Suite's optional cloud services (P4.3).
//!
//! Clients are local-first and emit **no** telemetry by default ([`policy`]).
//! The cloud services emit structured logs, metrics, and traces, but never any
//! decryptable content or key material: [`log`] guards every log payload, and
//! [`metrics`] models only aggregate counts/gauges (relay health, release
//! adoption, error rates) rendered to the Prometheus exposition format.
//!
//! This crate is pure (no runtime logging/metrics stack): it provides the types
//! and guarantees, and each service binary wires them to `tracing-subscriber`
//! and a `/metrics` endpoint. Satisfies AC-OBS-1..3.
//!
//! ```
//! use hearth_observability::log::{assert_log_safe, redact};
//! use serde_json::json;
//!
//! // A safe operational event passes; a secret is refused.
//! assert!(assert_log_safe(&json!({ "event": "blob_admitted", "blob_id": "b1", "size_bytes": 42 })).is_ok());
//! assert!(assert_log_safe(&json!({ "secret_key": "..." })).is_err());
//! // ...and `redact` strips anything dangerous defensively.
//! assert!(redact(&json!({ "secret_key": "x" })).get("secret_key").is_none());
//! ```

pub mod error;
pub mod log;
pub mod metrics;
pub mod policy;

pub use error::{Error, Result};
pub use metrics::{render_prometheus, ErrorRate, Metric, MetricKind, RelayHealth, ReleaseAdoption};
pub use policy::TelemetryPolicy;
