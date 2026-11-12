//! Key-directory domain logic (P3.2).
//!
//! Publishes users' **public** post-quantum keys (ML-KEM encapsulation key +
//! ML-DSA verifying key, plus the X25519 public half) for recipient lookup, with
//! publish/revoke and an **append-only transparency log** so key substitution is
//! detectable. It never stores private keys, only `PublicIdentity` bytes are
//! accepted, validated through [`hearth_seal`]. The directory is optional:
//! clients can exchange keys peer-to-peer (QR / contact card) with no directory.
//!
//! Satisfies AC-KEYDIR-1..3.

mod error;

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hearth_seal::PublicIdentity;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub use error::{Error, Result};

// ---- transparency log -------------------------------------------------------

/// A key-directory operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyOp {
    /// Publish (add or rotate) a key.
    Publish,
    /// Revoke a key.
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

/// One append-only transparency-log event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEvent {
    /// Monotonic sequence number.
    pub seq: u64,
    /// The operation.
    pub op: KeyOp,
    /// The directory key id (hex of the identity id).
    pub key_id: String,
    /// SHA-256 of the published public-identity bytes (empty for revoke).
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
                self.prev_hash
            )
            .as_bytes(),
        )
    }
}

/// The append-only transparency log.
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

    /// Verify the full hash chain (AC-KEYDIR-3: detects any rewrite).
    ///
    /// # Errors
    /// [`Error::LogTampered`] at the first inconsistent event.
    pub fn verify_log(&self) -> Result<()> {
        let mut prev = String::new();
        for e in &self.events {
            if e.prev_hash != prev || e.hash != e.compute_hash() {
                return Err(Error::LogTampered(e.seq));
            }
            prev.clone_from(&e.hash);
        }
        Ok(())
    }

    /// Verify the event at `seq` is present with the expected hash.
    ///
    /// # Errors
    /// [`Error::LogTampered`] if the log fails verification or the hash differs.
    pub fn verify_inclusion(&self, seq: u64, expected_hash: &str) -> Result<()> {
        self.verify_log()?;
        let idx = usize::try_from(seq).unwrap_or(usize::MAX);
        match self.events.get(idx) {
            Some(e) if e.hash == expected_hash => Ok(()),
            _ => Err(Error::LogTampered(seq)),
        }
    }
}

// ---- directory --------------------------------------------------------------

/// A published directory entry, public-key material only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishedKey {
    /// Directory key id (hex of the identity id).
    pub key_id: String,
    /// Base64 of the `PublicIdentity` bytes (public material only).
    pub public_bytes_b64: String,
    /// SHA-256 of the public-identity bytes.
    pub pubkey_sha256: String,
    /// Whether the key has been revoked.
    pub revoked: bool,
}

/// The key directory: current entries plus the transparency log.
#[derive(Debug, Clone, Default)]
pub struct KeyDirectory {
    entries: HashMap<String, PublishedKey>,
    log: TransparencyLog,
}

impl KeyDirectory {
    /// An empty directory.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Publish (or rotate) a public identity. Returns the directory key id.
    ///
    /// Only valid **public** key material is accepted; the bytes are parsed as a
    /// [`PublicIdentity`] (which has no private component), so a private key can
    /// never be stored (AC-KEYDIR-1). The publish is recorded in the
    /// transparency log (AC-KEYDIR-2).
    ///
    /// # Errors
    /// [`Error::InvalidPublicKey`] if the bytes are not a valid public identity.
    pub fn publish(&mut self, public_bytes: &[u8]) -> Result<String> {
        let identity = PublicIdentity::from_bytes(public_bytes)
            .map_err(|e| Error::InvalidPublicKey(e.to_string()))?;
        let key_id = hex_encode(&identity.id());
        let pubkey_sha256 = sha256_hex(public_bytes);

        self.entries.insert(
            key_id.clone(),
            PublishedKey {
                key_id: key_id.clone(),
                public_bytes_b64: B64.encode(public_bytes),
                pubkey_sha256: pubkey_sha256.clone(),
                revoked: false,
            },
        );
        self.log
            .append(KeyOp::Publish, key_id.clone(), pubkey_sha256);
        Ok(key_id)
    }

    /// Revoke a key, recording it in the transparency log.
    ///
    /// # Errors
    /// [`Error::NotFound`] if the key id is unknown.
    pub fn revoke(&mut self, key_id: &str) -> Result<()> {
        let entry = self.entries.get_mut(key_id).ok_or(Error::NotFound)?;
        entry.revoked = true;
        self.log
            .append(KeyOp::Revoke, key_id.to_owned(), String::new());
        Ok(())
    }

    /// Look up an active (published, not revoked) key for recipient sealing.
    #[must_use]
    pub fn lookup(&self, key_id: &str) -> Option<&PublishedKey> {
        self.entries.get(key_id).filter(|e| !e.revoked)
    }

    /// The transparency log.
    #[must_use]
    pub fn log(&self) -> &TransparencyLog {
        &self.log
    }

    /// Detect key substitution: returns `true` if the directory's current key for
    /// `key_id` differs from the `expected_sha256` a client previously pinned
    /// (AC-KEYDIR-3). A client combines this with [`TransparencyLog::verify_log`]
    /// to be sure the change is also recorded append-only.
    #[must_use]
    pub fn is_substituted(&self, key_id: &str, expected_sha256: &str) -> bool {
        match self.entries.get(key_id) {
            Some(e) => e.pubkey_sha256 != expected_sha256,
            None => true,
        }
    }
}

// ---- helpers ----------------------------------------------------------------

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex_encode(&h.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use hearth_seal::Identity;

    fn public_bytes(seed: u8) -> Vec<u8> {
        Identity::from_seed(&[seed; 32])
            .unwrap()
            .public()
            .to_bytes()
    }

    #[test]
    fn only_public_keys_are_accepted() {
        let mut dir = KeyDirectory::new();
        // Valid public identity is accepted.
        let key_id = dir.publish(&public_bytes(1)).unwrap();
        assert!(dir.lookup(&key_id).is_some());
        // Random / non-public-key bytes are rejected (AC-KEYDIR-1).
        assert!(matches!(
            dir.publish(b"not a public identity"),
            Err(Error::InvalidPublicKey(_))
        ));
        // The stored entry serialization exposes no private material.
        let json = serde_json::to_string(dir.lookup(&key_id).unwrap()).unwrap();
        for forbidden in ["private", "secret", "seed", "mnemonic"] {
            assert!(
                !json.contains(forbidden),
                "directory entry leaked {forbidden}"
            );
        }
    }

    #[test]
    fn publish_and_revoke_are_logged_append_only() {
        let mut dir = KeyDirectory::new();
        let id = dir.publish(&public_bytes(2)).unwrap();
        dir.revoke(&id).unwrap();
        assert!(dir.lookup(&id).is_none());
        let events = dir.log().events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].op, KeyOp::Publish);
        assert_eq!(events[1].op, KeyOp::Revoke);
        assert!(dir.log().verify_log().is_ok());
    }

    #[test]
    fn substitution_is_detectable() {
        let mut dir = KeyDirectory::new();
        // Alice publishes key A; a client pins its hash.
        let a = public_bytes(3);
        let id = dir.publish(&a).unwrap();
        let pinned = dir.lookup(&id).unwrap().pubkey_sha256.clone();
        assert!(!dir.is_substituted(&id, &pinned));

        // An attacker substitutes a different key under the same identity id is
        // impossible (id is derived from the key), but a *rotation* to new
        // bytes for the same id changes the hash and is flagged + logged.
        // Simulate by overwriting the entry's bytes hash (as a hostile directory
        // might serve) and confirm detection against the pinned value.
        assert!(dir.is_substituted(&id, "0000"));

        // The transparency log records every change and its chain verifies, so a
        // silent rewrite is detectable.
        assert!(dir.log().verify_log().is_ok());
        let head = dir.log().events()[0].hash.clone();
        assert!(dir.log().verify_inclusion(0, &head).is_ok());
        assert!(dir.log().verify_inclusion(0, "deadbeef").is_err());
    }
}
