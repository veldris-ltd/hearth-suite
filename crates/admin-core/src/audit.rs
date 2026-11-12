//! An append-only, tamper-evident audit log of admin actions (AC-ADMIN-1, 2).
//!
//! Every admin action, allowed *or* denied, is appended as an [`AuditEntry`].
//! Entries form a hash chain (each hashes the previous head), so any alteration
//! or deletion of a past entry breaks every subsequent hash. The head hash can
//! additionally be signed by an offline operator key ([`sign_head`]), giving
//! external tamper-evidence even against an actor with write access to storage.
//! There is no API to mutate or remove an entry, only [`record`](AuditLog::record).

use serde::{Deserialize, Serialize};

use hearth_seal::{ReleaseSigningKey, ReleaseVerifyingKey};

use crate::error::{Error, Result};
use crate::hash::sha256_hex;

/// Whether an audited action was permitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The action was authorized and performed.
    Allowed,
    /// The action was denied by RBAC (recorded per AC-ADMIN-1).
    Denied,
}

impl Outcome {
    fn label(self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Denied => "denied",
        }
    }
}

/// One immutable audit record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Monotonic sequence number (0-based).
    pub seq: u64,
    /// Unix timestamp (seconds) supplied by the API at record time.
    pub at: u64,
    /// The operator identity that acted.
    pub actor: String,
    /// The action attempted.
    pub action: String,
    /// The target the action applied to (e.g. a blob id, release version).
    pub target: String,
    /// Whether the action was allowed or denied.
    pub outcome: Outcome,
    /// Hash of the previous entry (empty for the first).
    pub prev_hash: String,
    /// This entry's hash over its fields and `prev_hash`.
    pub hash: String,
}

impl AuditEntry {
    /// Recompute the canonical hash for this entry's content.
    fn compute_hash(&self) -> String {
        sha256_hex(
            format!(
                "{}|{}|{}|{}|{}|{}|{}",
                self.seq,
                self.at,
                self.actor,
                self.action,
                self.target,
                self.outcome.label(),
                self.prev_hash,
            )
            .as_bytes(),
        )
    }
}

/// The append-only audit log.
#[derive(Debug, Clone, Default)]
pub struct AuditLog {
    entries: Vec<AuditEntry>,
}

impl AuditLog {
    /// An empty log.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Append an action to the log, returning the new entry.
    ///
    /// This is the only way to add to the log; entries are never modified or
    /// removed afterwards.
    pub fn record(
        &mut self,
        at: u64,
        actor: impl Into<String>,
        action: impl Into<String>,
        target: impl Into<String>,
        outcome: Outcome,
    ) -> &AuditEntry {
        let seq = u64::try_from(self.entries.len()).unwrap_or(u64::MAX);
        let prev_hash = self.head_hash().to_owned();
        let mut entry = AuditEntry {
            seq,
            at,
            actor: actor.into(),
            action: action.into(),
            target: target.into(),
            outcome,
            prev_hash,
            hash: String::new(),
        };
        entry.hash = entry.compute_hash();
        self.entries.push(entry);
        // The vec is non-empty after the push.
        &self.entries[self.entries.len() - 1]
    }

    /// All entries, oldest first.
    #[must_use]
    pub fn entries(&self) -> &[AuditEntry] {
        &self.entries
    }

    /// The current head hash (empty if the log is empty).
    #[must_use]
    pub fn head_hash(&self) -> &str {
        self.entries.last().map_or("", |e| e.hash.as_str())
    }

    /// Verify the full hash chain.
    ///
    /// # Errors
    /// Returns [`Error::AuditTampered`] with the sequence of the first entry
    /// whose hash or back-link does not match.
    pub fn verify_chain(&self) -> Result<()> {
        let mut prev = String::new();
        for entry in &self.entries {
            if entry.prev_hash != prev || entry.hash != entry.compute_hash() {
                return Err(Error::AuditTampered(entry.seq));
            }
            prev.clone_from(&entry.hash);
        }
        Ok(())
    }

    /// Sign the current head hash with an offline operator key.
    ///
    /// Publishing/anchoring this signature lets anyone confirm the log has not
    /// been rewritten, even by someone with storage write access.
    #[must_use]
    pub fn sign_head(&self, key: &ReleaseSigningKey) -> Vec<u8> {
        key.sign(self.head_hash().as_bytes())
    }

    /// Verify a head signature produced by [`sign_head`].
    ///
    /// # Errors
    /// Returns an error if the signature does not match the current head.
    pub fn verify_head(&self, signature: &[u8], key: &ReleaseVerifyingKey) -> Result<()> {
        key.verify(self.head_hash().as_bytes(), signature)
            .map_err(|_| {
                Error::AuditTampered(u64::try_from(self.entries.len()).unwrap_or(u64::MAX))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> AuditLog {
        let mut log = AuditLog::new();
        log.record(
            100,
            "alice",
            "manage_relay_quota",
            "relay-eu",
            Outcome::Allowed,
        );
        log.record(101, "bob", "sign_release", "v1.2.0", Outcome::Denied);
        log.record(102, "alice", "promote_channel", "v1.1.0", Outcome::Allowed);
        log
    }

    #[test]
    fn chain_verifies_and_links() {
        let log = sample();
        assert!(log.verify_chain().is_ok());
        assert_eq!(log.entries().len(), 3);
        assert_eq!(log.entries()[0].prev_hash, "");
        assert_eq!(log.entries()[1].prev_hash, log.entries()[0].hash);
        assert_eq!(log.entries()[2].prev_hash, log.entries()[1].hash);
    }

    #[test]
    fn denied_actions_are_recorded() {
        let log = sample();
        assert_eq!(log.entries()[1].outcome, Outcome::Denied);
    }

    #[test]
    fn tampering_breaks_the_chain() {
        let mut log = sample();
        // Rewrite a past entry's target as a malicious operator might.
        log.entries[0].target = "relay-us".to_owned();
        assert!(matches!(log.verify_chain(), Err(Error::AuditTampered(0))));
    }

    #[test]
    fn signed_head_detects_rewrite() {
        let key = ReleaseSigningKey::from_seed(&[7u8; 32]).unwrap();
        let log = sample();
        let sig = log.sign_head(&key);
        assert!(log.verify_head(&sig, &key.verifying_key()).is_ok());

        // A log with a different history has a different head → signature fails.
        let mut other = sample();
        other.record(103, "mallory", "revoke_key", "k-9", Outcome::Allowed);
        assert!(other.verify_head(&sig, &key.verifying_key()).is_err());
    }
}
