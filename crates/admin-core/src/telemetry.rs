//! Observability: aggregate-only telemetry with a content-redaction guard
//! (AC-ADMIN-4).
//!
//! Operators see service health and *aggregate* counts, never user content.
//! [`HealthSnapshot`] carries only numbers, and [`assert_aggregate_only`] is a
//! defensive gate any telemetry payload must pass before display: it rejects any
//! field whose name hints at carrying user content, so a misconfigured collector
//! can never surface document text in the panel.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};

/// A point-in-time health/usage snapshot for one service. Aggregates only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthSnapshot {
    /// Service name (e.g. `sync-relay`).
    pub service: String,
    /// Whether the service is currently healthy.
    pub healthy: bool,
    /// Uptime in seconds.
    pub uptime_seconds: u64,
    /// Total requests served (counter).
    pub requests_total: u64,
    /// Error rate in per-mille (errors per 1000 requests).
    pub error_rate_milli: u32,
    /// Number of blobs stored (relay).
    pub blobs_stored: u64,
    /// Total bytes stored (relay).
    pub bytes_stored: u64,
}

/// Substrings that must never appear as a telemetry field name, they would
/// signal a payload carrying (or capable of carrying) user content.
const FORBIDDEN_KEY_SUBSTRINGS: &[&str] = &[
    "content",
    "plaintext",
    "cleartext",
    "document",
    "body",
    "message",
    "attachment",
    "filename",
    "subject",
    "note",
    "text",
    "payload",
];

/// Assert that a telemetry payload is aggregate-only: no field name (at any
/// depth) hints at user content.
///
/// # Errors
/// Returns [`Error::ContentLeak`] naming the first offending field.
pub fn assert_aggregate_only(value: &Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let lower = key.to_ascii_lowercase();
                if let Some(bad) = FORBIDDEN_KEY_SUBSTRINGS
                    .iter()
                    .find(|needle| lower.contains(*needle))
                {
                    return Err(Error::ContentLeak((*bad).to_owned()));
                }
                assert_aggregate_only(child)?;
            }
            Ok(())
        }
        Value::Array(items) => {
            for item in items {
                assert_aggregate_only(item)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Convenience: validate a [`HealthSnapshot`] is aggregate-only (always true by
/// construction, but exercises the guard on the real type).
///
/// # Errors
/// Returns [`Error::Json`] if serialization fails, or [`Error::ContentLeak`] if
/// the guard trips (it must not, for this type).
pub fn check_snapshot(snapshot: &HealthSnapshot) -> Result<()> {
    assert_aggregate_only(&serde_json::to_value(snapshot)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aggregate_snapshot_passes() {
        let snap = HealthSnapshot {
            service: "sync-relay".to_owned(),
            healthy: true,
            uptime_seconds: 3600,
            requests_total: 1_000_000,
            error_rate_milli: 2,
            blobs_stored: 5000,
            bytes_stored: 9_000_000,
        };
        assert!(check_snapshot(&snap).is_ok());
    }

    #[test]
    fn payload_with_content_field_is_rejected() {
        // A misconfigured collector tries to ship document text.
        let leaky = json!({
            "service": "sync-relay",
            "requests_total": 10,
            "sample": { "document_body": "Dear Bob, the merger..." }
        });
        assert!(matches!(
            assert_aggregate_only(&leaky),
            Err(Error::ContentLeak(_))
        ));
    }

    #[test]
    fn nested_and_array_payloads_are_scanned() {
        let leaky = json!({ "items": [ { "ok": 1 }, { "plaintext": "secret" } ] });
        assert!(assert_aggregate_only(&leaky).is_err());

        let clean = json!({ "items": [ { "ok": 1 }, { "count": 2 } ], "healthy": true });
        assert!(assert_aggregate_only(&clean).is_ok());
    }
}
