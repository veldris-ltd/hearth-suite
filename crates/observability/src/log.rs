//! Structured-log safety: logs must never contain decryptable content or keys
//! (AC-OBS-2).
//!
//! Services emit structured (JSON) log events built from *safe* fields, ids,
//! counts, durations, status codes, error kinds. This module provides the guard
//! that proves a log payload carries none of the dangerous material: secret key
//! material, recovery phrases, auth tokens, or user document content.
//!
//! The forbidden set is deliberately specific (e.g. `secret_key`, `content_base64`)
//! so legitimate identifiers like `key_id`, `pubkey_sha256`, or `context` are not
//! falsely rejected, while anything that could decrypt or identify content is.

use serde_json::{Map, Value};

use crate::error::{Error, Result};

/// Field-name substrings that must never appear in a log payload, each is an
/// unambiguous marker of secret material or user content.
const FORBIDDEN: &[&str] = &[
    // secret key material / auth
    "secret",
    "password",
    "passphrase",
    "mnemonic",
    "private_key",
    "privatekey",
    "secret_key",
    "signing_key",
    "seed_phrase",
    "recovery_phrase",
    "api_key",
    "access_token",
    "refresh_token",
    "session_token",
    "authorization",
    "credential",
    "cookie",
    // decryptable / user content
    "plaintext",
    "cleartext",
    "content_base64",
    "document_body",
    "decrypted",
];

fn offending_key(key: &str) -> Option<&'static str> {
    let lower = key.to_ascii_lowercase();
    FORBIDDEN
        .iter()
        .copied()
        .find(|needle| lower.contains(needle))
}

/// Assert that a structured-log payload carries no secret or content field
/// (recursively).
///
/// # Errors
/// Returns [`Error::UnsafeLogField`] naming the first offending field.
pub fn assert_log_safe(value: &Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if let Some(bad) = offending_key(key) {
                    return Err(Error::UnsafeLogField(bad.to_owned()));
                }
                assert_log_safe(child)?;
            }
            Ok(())
        }
        Value::Array(items) => {
            for item in items {
                assert_log_safe(item)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Return a copy of `value` with any offending field **dropped entirely**, a
/// defensive sink so an accidental secret never reaches a log even if a caller
/// forgets to keep its event clean. The result always passes [`assert_log_safe`].
#[must_use]
pub fn redact(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = Map::with_capacity(map.len());
            for (key, child) in map {
                if offending_key(key).is_some() {
                    continue; // strip the field (name and value) completely
                }
                out.insert(key.clone(), redact(child));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn safe_operational_event_passes() {
        let event = json!({
            "level": "info",
            "service": "sync-relay",
            "event": "blob_admitted",
            "blob_id": "b-123",
            "size_bytes": 4096,
            "status": 200,
            "duration_ms": 7,
            "key_id": "k-1",
            "pubkey_sha256": "abcd",
            "context": "store"
        });
        assert!(assert_log_safe(&event).is_ok());
    }

    #[test]
    fn secret_and_content_fields_are_rejected() {
        for bad in [
            json!({ "secret_key": "..." }),
            json!({ "recovery_phrase": "word word ..." }),
            json!({ "authorization": "Bearer ..." }),
            json!({ "content_base64": "..." }),
            json!({ "nested": [{ "plaintext": "secret letter" }] }),
        ] {
            assert!(assert_log_safe(&bad).is_err(), "should reject: {bad}");
        }
    }

    #[test]
    fn redact_drops_offending_fields_only() {
        let masked = redact(&json!({
            "blob_id": "b-1",
            "secret_key": "DEADBEEF",
            "inner": { "password": "hunter2", "count": 3 }
        }));
        assert_eq!(masked["blob_id"], json!("b-1"));
        assert!(masked.get("secret_key").is_none());
        assert!(masked["inner"].get("password").is_none());
        assert_eq!(masked["inner"]["count"], json!(3));
        // A redacted payload always passes the safety assertion.
        assert!(assert_log_safe(&masked).is_ok());
    }
}
