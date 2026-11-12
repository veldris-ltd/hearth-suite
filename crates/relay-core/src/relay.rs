//! Per-account quota accounting and blob lifecycle (AC-RELAY-1, 2, 3).
//!
//! The relay is **architecturally incapable of reading content**: it only ever
//! handles opaque, client-encrypted bytes (stored in the object store) plus the
//! metadata modelled here. [`BlobMeta`] carries an id, owning account, size, TTL,
//! and lifecycle state, never content and never a key. No content key can reach
//! this crate by construction.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// An opaque account identifier (derived from an auth token by the service).
pub type AccountId = String;

/// A per-account storage quota.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quota {
    /// Maximum total stored bytes per account (active + expired-not-reclaimed).
    pub max_bytes: u64,
    /// Maximum number of stored blobs per account.
    pub max_blobs: u64,
}

/// A blob's lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlobState {
    /// Live and counting against quota.
    Active,
    /// Past its TTL; awaiting GC (still counts against quota).
    Expired,
    /// Reclaimed by GC; storage freed.
    Reclaimed,
}

/// Metadata for one stored blob, **never** its contents or any key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobMeta {
    /// Opaque blob id (content-address / random handle).
    pub id: String,
    /// Owning account.
    pub account: AccountId,
    /// Ciphertext size in bytes.
    pub size_bytes: u64,
    /// Time-to-live in seconds from `created_at`.
    pub ttl_seconds: u64,
    /// Unix timestamp (seconds) the blob was stored.
    pub created_at: u64,
    /// Current lifecycle state.
    pub state: BlobState,
}

/// In-memory quota + lifecycle ledger. The service persists this in Postgres;
/// the accounting rules are identical and tested here.
#[derive(Debug, Clone)]
pub struct RelayLedger {
    quota: Quota,
    blobs: Vec<BlobMeta>,
}

impl RelayLedger {
    /// A ledger applying `quota` to every account.
    #[must_use]
    pub fn new(quota: Quota) -> Self {
        Self {
            quota,
            blobs: Vec::new(),
        }
    }

    /// Bytes counting against an account's quota (active + expired).
    #[must_use]
    pub fn used_bytes(&self, account: &str) -> u64 {
        self.blobs
            .iter()
            .filter(|b| b.account == account && b.state != BlobState::Reclaimed)
            .map(|b| b.size_bytes)
            .sum()
    }

    /// Blobs counting against an account's quota (active + expired).
    #[must_use]
    pub fn used_blobs(&self, account: &str) -> u64 {
        let n = self
            .blobs
            .iter()
            .filter(|b| b.account == account && b.state != BlobState::Reclaimed)
            .count();
        u64::try_from(n).unwrap_or(u64::MAX)
    }

    /// Admit a new opaque blob for `account`, enforcing the quota (AC-RELAY-2).
    ///
    /// # Errors
    /// [`Error::InvalidBlob`] for a zero-size blob; [`Error::QuotaExceeded`] if
    /// the byte or count quota would be breached.
    pub fn admit(
        &mut self,
        account: impl Into<AccountId>,
        id: impl Into<String>,
        size_bytes: u64,
        ttl_seconds: u64,
        created_at: u64,
    ) -> Result<()> {
        if size_bytes == 0 {
            return Err(Error::InvalidBlob("zero-size blob".to_owned()));
        }
        let account = account.into();
        if self.used_bytes(&account).saturating_add(size_bytes) > self.quota.max_bytes {
            return Err(Error::QuotaExceeded("byte quota".to_owned()));
        }
        if self.used_blobs(&account).saturating_add(1) > self.quota.max_blobs {
            return Err(Error::QuotaExceeded("blob count quota".to_owned()));
        }
        self.blobs.push(BlobMeta {
            id: id.into(),
            account,
            size_bytes,
            ttl_seconds,
            created_at,
            state: BlobState::Active,
        });
        Ok(())
    }

    /// Look up a blob's metadata.
    #[must_use]
    pub fn get(&self, account: &str, id: &str) -> Option<&BlobMeta> {
        self.blobs
            .iter()
            .find(|b| b.account == account && b.id == id && b.state != BlobState::Reclaimed)
    }

    /// Mark all blobs whose TTL elapsed by `now` as expired. Returns the count.
    pub fn expire_due(&mut self, now: u64) -> usize {
        let mut n = 0;
        for b in &mut self.blobs {
            if b.state == BlobState::Active && b.created_at.saturating_add(b.ttl_seconds) <= now {
                b.state = BlobState::Expired;
                n += 1;
            }
        }
        n
    }

    /// Reclaim every expired blob, freeing its quota (AC-RELAY-3). Returns the
    /// `(account, id)` of each reclaimed blob so the service can delete the
    /// corresponding object from the store.
    pub fn collect_garbage(&mut self) -> Vec<(AccountId, String)> {
        let mut reclaimed = Vec::new();
        for b in &mut self.blobs {
            if b.state == BlobState::Expired {
                b.state = BlobState::Reclaimed;
                reclaimed.push((b.account.clone(), b.id.clone()));
            }
        }
        reclaimed
    }

    /// All non-reclaimed blob metadata (state inspection; never content).
    pub fn live_blobs(&self) -> impl Iterator<Item = &BlobMeta> {
        self.blobs
            .iter()
            .filter(|b| b.state != BlobState::Reclaimed)
    }

    /// Aggregate stored bytes across all accounts (for metrics).
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.blobs
            .iter()
            .filter(|b| b.state != BlobState::Reclaimed)
            .map(|b| b.size_bytes)
            .sum()
    }
}

/// The per-account byte usage map (for metrics / admin views).
#[must_use]
pub fn usage_by_account(ledger: &RelayLedger) -> HashMap<AccountId, u64> {
    let mut out: HashMap<AccountId, u64> = HashMap::new();
    for b in ledger.live_blobs() {
        *out.entry(b.account.clone()).or_default() += b.size_bytes;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger() -> RelayLedger {
        RelayLedger::new(Quota {
            max_bytes: 1000,
            max_blobs: 3,
        })
    }

    #[test]
    fn quota_rejected_gracefully() {
        let mut l = ledger();
        l.admit("alice", "a", 400, 60, 0).unwrap();
        l.admit("alice", "b", 400, 60, 0).unwrap();
        // Byte quota.
        assert!(matches!(
            l.admit("alice", "c", 300, 60, 0),
            Err(Error::QuotaExceeded(_))
        ));
        // Quotas are per-account: bob is unaffected.
        l.admit("bob", "x", 900, 60, 0).unwrap();
        // Zero-size rejected.
        assert!(matches!(
            l.admit("bob", "z", 0, 60, 0),
            Err(Error::InvalidBlob(_))
        ));
    }

    #[test]
    fn ttl_then_gc_reclaims_and_frees_quota() {
        let mut l = ledger();
        l.admit("alice", "a", 800, 100, 0).unwrap();
        assert_eq!(l.used_bytes("alice"), 800);

        assert_eq!(l.expire_due(50), 0); // not due
        assert_eq!(l.expire_due(200), 1); // past TTL
        assert_eq!(l.used_bytes("alice"), 800); // expired still counts

        let reclaimed = l.collect_garbage();
        assert_eq!(reclaimed, vec![("alice".to_owned(), "a".to_owned())]);
        assert_eq!(l.used_bytes("alice"), 0); // freed
        assert!(l.get("alice", "a").is_none());

        // Freed quota admits a new blob.
        l.admit("alice", "b", 900, 100, 300).unwrap();
        assert_eq!(l.used_bytes("alice"), 900);
    }

    #[test]
    fn blob_metadata_carries_no_content_or_key() {
        let meta = BlobMeta {
            id: "b1".to_owned(),
            account: "alice".to_owned(),
            size_bytes: 10,
            ttl_seconds: 60,
            created_at: 0,
            state: BlobState::Active,
        };
        let json = serde_json::to_string(&meta).unwrap_or_default();
        for forbidden in ["content", "plaintext", "key", "secret", "payload"] {
            assert!(
                !json.contains(forbidden),
                "relay metadata leaked {forbidden}"
            );
        }
    }
}
