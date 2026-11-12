//! Key-directory operations and the public transparency log (AC-ADMIN-4, 5).
//!
//! The directory publishes users' *public* post-quantum keys and revocations as
//! an append-only, hash-chained transparency log, the same tamper-evidence
//! model as the audit log. Operators publish and revoke entries; anyone can
//! verify the log and an entry's inclusion. Only public-key material and opaque
//! ids appear here, never user content.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::hash::sha256_hex;

/// A key-directory operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyOp {
    /// Publish (add/update) a key for an identity.
    Publish,
    /// Revoke a previously published key.
    Revoke,
}

impl KeyOp {
    fn label(self) -> &'static str {
        match self {
            Self::Publish => "publish",
            Self::Revoke => "revoke",
        }
    }
}

/// One transparency-log event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEvent {
    /// Monotonic sequence number.
    pub seq: u64,
    /// The operation.
    pub op: KeyOp,
    /// The directory entry's identity id (opaque).
    pub key_id: String,
    /// SHA-256 of the published public key bytes (empty for revoke).
    pub pubkey_sha256: String,
    /// Hash of the previous event (empty for the first).
    pub prev_hash: String,
    /// This event's hash.
    pub hash: String,
}

impl KeyEvent {
    fn compute_hash(&self) -> String {
        sha256_hex(
            format!(
                "{}|{}|{}|{}|{}",
                self.seq,
                self.op.label(),
                self.key_id,
                self.pubkey_sha256,
                self.prev_hash,
            )
            .as_bytes(),
        )
    }
}

/// The append-only key-directory transparency log.
#[derive(Debug, Clone, Default)]
pub struct TransparencyLog {
    events: Vec<KeyEvent>,
}

impl TransparencyLog {
    /// An empty log.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Publish a public key for `key_id` (hashes the key bytes).
    pub fn publish(&mut self, key_id: impl Into<String>, public_key: &[u8]) -> &KeyEvent {
        self.append(KeyOp::Publish, key_id.into(), sha256_hex(public_key))
    }

    /// Revoke the key for `key_id`.
    pub fn revoke(&mut self, key_id: impl Into<String>) -> &KeyEvent {
        self.append(KeyOp::Revoke, key_id.into(), String::new())
    }

    fn append(&mut self, op: KeyOp, key_id: String, pubkey_sha256: String) -> &KeyEvent {
        let seq = u64::try_from(self.events.len()).unwrap_or(u64::MAX);
        let prev_hash = self.head_hash().to_owned();
        let mut event = KeyEvent {
            seq,
            op,
            key_id,
            pubkey_sha256,
            prev_hash,
            hash: String::new(),
        };
        event.hash = event.compute_hash();
        self.events.push(event);
        &self.events[self.events.len() - 1]
    }

    /// All events, oldest first.
    #[must_use]
    pub fn events(&self) -> &[KeyEvent] {
        &self.events
    }

    /// The current head hash.
    #[must_use]
    pub fn head_hash(&self) -> &str {
        self.events.last().map_or("", |e| e.hash.as_str())
    }

    /// The latest operation recorded for `key_id`, if any.
    #[must_use]
    pub fn latest_for(&self, key_id: &str) -> Option<&KeyEvent> {
        self.events.iter().rev().find(|e| e.key_id == key_id)
    }

    /// Whether `key_id` currently has an active (published, not revoked) key.
    #[must_use]
    pub fn is_active(&self, key_id: &str) -> bool {
        matches!(self.latest_for(key_id), Some(e) if e.op == KeyOp::Publish)
    }

    /// Verify the full hash chain.
    ///
    /// # Errors
    /// Returns [`Error::KeyLogTampered`] with the sequence of the first event
    /// whose hash or back-link is inconsistent.
    pub fn verify_log(&self) -> Result<()> {
        let mut prev = String::new();
        for event in &self.events {
            if event.prev_hash != prev || event.hash != event.compute_hash() {
                return Err(Error::KeyLogTampered(event.seq));
            }
            prev.clone_from(&event.hash);
        }
        Ok(())
    }

    /// Verify that the event at `seq` is included with the given hash (a simple
    /// inclusion check over the verified chain).
    ///
    /// # Errors
    /// Returns [`Error::KeyLogTampered`] if the log fails verification or the
    /// hash at `seq` does not match.
    pub fn verify_inclusion(&self, seq: u64, expected_hash: &str) -> Result<()> {
        self.verify_log()?;
        let idx = usize::try_from(seq).unwrap_or(usize::MAX);
        match self.events.get(idx) {
            Some(e) if e.hash == expected_hash => Ok(()),
            _ => Err(Error::KeyLogTampered(seq)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_revoke_and_activity() {
        let mut log = TransparencyLog::new();
        log.publish("alice", b"alice-pq-public");
        log.publish("bob", b"bob-pq-public");
        assert!(log.is_active("alice"));
        assert!(log.is_active("bob"));

        log.revoke("alice");
        assert!(!log.is_active("alice"));
        assert!(log.is_active("bob"));
        assert!(log.verify_log().is_ok());
    }

    #[test]
    fn inclusion_verifies() {
        let mut log = TransparencyLog::new();
        let h = log.publish("alice", b"k").hash.clone();
        assert!(log.verify_inclusion(0, &h).is_ok());
        assert!(log.verify_inclusion(0, "deadbeef").is_err());
    }

    #[test]
    fn tampering_breaks_the_log() {
        let mut log = TransparencyLog::new();
        log.publish("alice", b"k1");
        log.publish("bob", b"k2");
        log.events[0].key_id = "mallory".to_owned();
        assert!(matches!(log.verify_log(), Err(Error::KeyLogTampered(0))));
    }
}
