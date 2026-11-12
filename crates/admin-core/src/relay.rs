//! Relay management: quotas and blob lifecycle (AC-ADMIN-4, 5).
//!
//! The relay is a zero-knowledge store: it holds only opaque encrypted blobs.
//! Accordingly [`BlobMeta`] carries *no* content field, only an id, a size, a
//! TTL, and lifecycle state. An operator can set quotas and expire/reclaim
//! blobs, but can never read what a blob contains.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// A relay quota.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quota {
    /// Maximum total stored bytes (active + expired-but-not-reclaimed).
    pub max_bytes: u64,
    /// Maximum number of stored blobs.
    pub max_blobs: u64,
}

/// A blob's lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlobState {
    /// Live and counting against quota.
    Active,
    /// Past its TTL; awaiting garbage collection (still counts against quota).
    Expired,
    /// Reclaimed by GC; storage freed.
    Reclaimed,
}

/// Metadata for one stored blob, **never** its contents (`AC-ADMIN-4`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobMeta {
    /// Opaque blob id (a content-address / random handle).
    pub id: String,
    /// Ciphertext size in bytes.
    pub size_bytes: u64,
    /// Time-to-live in seconds from `created_at`.
    pub ttl_seconds: u64,
    /// Unix timestamp (seconds) the blob was stored.
    pub created_at: u64,
    /// Current lifecycle state.
    pub state: BlobState,
}

/// The relay's operational state: its quota and the blobs it holds.
#[derive(Debug, Clone)]
pub struct RelayState {
    quota: Quota,
    blobs: Vec<BlobMeta>,
}

impl RelayState {
    /// A relay with the given quota and no blobs.
    #[must_use]
    pub fn new(quota: Quota) -> Self {
        Self {
            quota,
            blobs: Vec::new(),
        }
    }

    /// The current quota.
    #[must_use]
    pub fn quota(&self) -> Quota {
        self.quota
    }

    /// Update the quota (an audited operator action).
    pub fn set_quota(&mut self, quota: Quota) {
        self.quota = quota;
    }

    /// Bytes currently counting against quota (active + expired).
    #[must_use]
    pub fn used_bytes(&self) -> u64 {
        self.blobs
            .iter()
            .filter(|b| b.state != BlobState::Reclaimed)
            .map(|b| b.size_bytes)
            .sum()
    }

    /// Blobs currently counting against quota (active + expired).
    #[must_use]
    pub fn used_blobs(&self) -> u64 {
        let count = self
            .blobs
            .iter()
            .filter(|b| b.state != BlobState::Reclaimed)
            .count();
        u64::try_from(count).unwrap_or(u64::MAX)
    }

    /// Admit a new blob, enforcing the quota.
    ///
    /// `id`, `size_bytes`, `ttl_seconds`, and `created_at` are metadata only -
    /// the relay never sees plaintext.
    ///
    /// # Errors
    /// Returns [`Error::QuotaExceeded`] if the blob would breach the byte or
    /// count quota.
    pub fn admit(
        &mut self,
        id: impl Into<String>,
        size_bytes: u64,
        ttl_seconds: u64,
        created_at: u64,
    ) -> Result<()> {
        if self.used_bytes().saturating_add(size_bytes) > self.quota.max_bytes {
            return Err(Error::QuotaExceeded("byte quota".to_owned()));
        }
        if self.used_blobs().saturating_add(1) > self.quota.max_blobs {
            return Err(Error::QuotaExceeded("blob count quota".to_owned()));
        }
        self.blobs.push(BlobMeta {
            id: id.into(),
            size_bytes,
            ttl_seconds,
            created_at,
            state: BlobState::Active,
        });
        Ok(())
    }

    /// Mark all blobs whose TTL has elapsed by `now` as expired. Returns the
    /// number transitioned.
    pub fn expire_due(&mut self, now: u64) -> usize {
        let mut expired = 0;
        for blob in &mut self.blobs {
            if blob.state == BlobState::Active
                && blob.created_at.saturating_add(blob.ttl_seconds) <= now
            {
                blob.state = BlobState::Expired;
                expired += 1;
            }
        }
        expired
    }

    /// Reclaim (GC) all expired blobs, freeing their storage. Returns the count.
    pub fn reclaim_expired(&mut self) -> usize {
        let mut reclaimed = 0;
        for blob in &mut self.blobs {
            if blob.state == BlobState::Expired {
                blob.state = BlobState::Reclaimed;
                reclaimed += 1;
            }
        }
        reclaimed
    }

    /// All blob metadata (state inspection; never content).
    #[must_use]
    pub fn blobs(&self) -> &[BlobMeta] {
        &self.blobs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_is_enforced() {
        let mut relay = RelayState::new(Quota {
            max_bytes: 1000,
            max_blobs: 2,
        });
        relay.admit("a", 400, 60, 0).unwrap();
        relay.admit("b", 400, 60, 0).unwrap();
        // Third blob breaches the count quota.
        assert!(matches!(
            relay.admit("c", 100, 60, 0),
            Err(Error::QuotaExceeded(_))
        ));
        // A large blob breaches the byte quota.
        let mut relay2 = RelayState::new(Quota {
            max_bytes: 1000,
            max_blobs: 10,
        });
        assert!(matches!(
            relay2.admit("big", 1001, 60, 0),
            Err(Error::QuotaExceeded(_))
        ));
    }

    #[test]
    fn lifecycle_expire_then_reclaim_frees_quota() {
        let mut relay = RelayState::new(Quota {
            max_bytes: 1000,
            max_blobs: 10,
        });
        relay.admit("a", 600, 100, 0).unwrap();
        assert_eq!(relay.used_bytes(), 600);

        // Not yet due.
        assert_eq!(relay.expire_due(50), 0);
        // Past TTL → expired (still counts).
        assert_eq!(relay.expire_due(200), 1);
        assert_eq!(relay.used_bytes(), 600);
        // Reclaim frees the space.
        assert_eq!(relay.reclaim_expired(), 1);
        assert_eq!(relay.used_bytes(), 0);
        assert_eq!(relay.blobs()[0].state, BlobState::Reclaimed);

        // Freed quota now admits a new blob.
        relay.admit("b", 900, 100, 300).unwrap();
        assert_eq!(relay.used_bytes(), 900);
    }

    #[test]
    fn blob_metadata_has_no_content_field() {
        // A compile-time guarantee expressed as a test: serializing blob
        // metadata yields only opaque fields, never content (AC-ADMIN-4).
        let meta = BlobMeta {
            id: "blob-1".to_owned(),
            size_bytes: 10,
            ttl_seconds: 60,
            created_at: 0,
            state: BlobState::Active,
        };
        let json = serde_json::to_string(&meta).unwrap();
        for forbidden in ["content", "plaintext", "body", "document"] {
            assert!(
                !json.contains(forbidden),
                "blob metadata leaked {forbidden}"
            );
        }
    }
}
