//! The signed TUF-style targets metadata and its verification.
//!
//! The on-disk shape matches the document emitted by `ci/tuf/generate-metadata.sh`
//! (a `targets`-role document), with the `signatures` array populated by a role
//! key. Verification recomputes the canonical bytes of the `signed` object from
//! the parsed structure, so it is insensitive to incidental whitespace.

use std::collections::BTreeMap;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hearth_seal::ReleaseSigningKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::roots::TrustedRoots;

/// The hashes recorded for a target artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hashes {
    /// Lower-case hex SHA-256 of the artifact bytes.
    pub sha256: String,
}

/// One target artifact entry: its hashes and length.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetEntry {
    /// Content hashes.
    pub hashes: Hashes,
    /// Length of the artifact, in bytes.
    pub length: u64,
}

/// The signed body of the targets metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedTargets {
    /// TUF role type; always `"targets"`.
    #[serde(rename = "_type")]
    pub type_: String,
    /// TUF spec version string.
    pub spec_version: String,
    /// Monotonic metadata version (for rollback protection).
    pub version: u32,
    /// Map of target name to its entry (sorted for deterministic encoding).
    pub targets: BTreeMap<String, TargetEntry>,
}

impl SignedTargets {
    /// A fresh `targets` document at `version` with no entries.
    #[must_use]
    pub fn new(version: u32) -> Self {
        Self {
            type_: "targets".to_owned(),
            spec_version: "1.0.0".to_owned(),
            version,
            targets: BTreeMap::new(),
        }
    }

    /// Add a target by hashing `bytes`, returning `self` for chaining.
    #[must_use]
    pub fn with_target(mut self, name: impl Into<String>, bytes: &[u8]) -> Self {
        self.targets.insert(name.into(), target_entry(bytes));
        self
    }

    /// The canonical byte encoding signed and verified over.
    ///
    /// # Errors
    /// Returns [`Error::Json`] if serialization fails (not expected for this
    /// closed structure).
    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(Error::from)
    }
}

/// A single detached signature over the `signed` body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    /// The id of the key that produced this signature.
    pub keyid: String,
    /// Base64 of the detached ML-DSA signature bytes.
    pub sig: String,
}

/// A complete release metadata document: signed body plus signatures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseMetadata {
    /// The signed targets body.
    pub signed: SignedTargets,
    /// Detached signatures over [`SignedTargets::canonical_bytes`].
    pub signatures: Vec<Signature>,
}

impl ReleaseMetadata {
    /// Parse metadata from a JSON document.
    ///
    /// # Errors
    /// Returns [`Error::Json`] if the document is not valid metadata JSON.
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(Error::from)
    }

    /// Serialize the metadata to a pretty JSON document.
    ///
    /// # Errors
    /// Returns [`Error::Json`] if serialization fails.
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(Error::from)
    }

    /// Verify the metadata against the pinned `roots`.
    ///
    /// Succeeds when at least one signature was produced by a pinned key and
    /// verifies over the canonical signed bytes (threshold of one for the
    /// single-`targets`-role scaffold; raised when the full root/snapshot/
    /// timestamp role set lands with the Release Service in P3.3).
    ///
    /// # Errors
    /// Returns [`Error::Untrusted`] if no trusted signature verifies, or
    /// [`Error::Signature`] if a signature field is not valid base64.
    pub fn verify(&self, roots: &TrustedRoots) -> Result<VerifiedTargets> {
        let canonical = self.signed.canonical_bytes()?;
        let mut trusted = false;
        for signature in &self.signatures {
            let Some(key) = roots.get(&signature.keyid) else {
                continue;
            };
            let raw = B64
                .decode(signature.sig.as_bytes())
                .map_err(|e| Error::Signature(e.to_string()))?;
            if key.verify(&canonical, &raw).is_ok() {
                trusted = true;
                break;
            }
        }
        if !trusted {
            return Err(Error::Untrusted);
        }
        Ok(VerifiedTargets {
            targets: self.signed.targets.clone(),
            version: self.signed.version,
        })
    }
}

/// The trusted target set produced by a successful [`ReleaseMetadata::verify`].
///
/// Holding this value is proof the signature check passed; the only remaining
/// gate before installing is to match a downloaded artifact's bytes against it.
pub struct VerifiedTargets {
    targets: BTreeMap<String, TargetEntry>,
    version: u32,
}

impl VerifiedTargets {
    /// The verified metadata version.
    #[must_use]
    pub fn version(&self) -> u32 {
        self.version
    }

    /// The names of the verified targets.
    pub fn target_names(&self) -> impl Iterator<Item = &str> {
        self.targets.keys().map(String::as_str)
    }

    /// Reject a non-monotonic update (rollback protection).
    ///
    /// # Errors
    /// Returns [`Error::Rollback`] if this version is not strictly newer than
    /// `current`.
    pub fn ensure_newer_than(&self, current: u32) -> Result<()> {
        if self.version > current {
            Ok(())
        } else {
            Err(Error::Rollback {
                current,
                offered: self.version,
            })
        }
    }

    /// Verify that `bytes` are exactly the artifact named `name` in the signed
    /// metadata, matching both length and SHA-256.
    ///
    /// This is the final gate before installing an update (AC-DESK-3): the
    /// downloaded bytes are only trusted once they match a signed entry.
    ///
    /// # Errors
    /// Returns [`Error::UnknownTarget`] if `name` is not in the metadata,
    /// [`Error::LengthMismatch`] if the size differs, or [`Error::HashMismatch`]
    /// if the SHA-256 differs.
    pub fn verify_artifact(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let entry = self
            .targets
            .get(name)
            .ok_or_else(|| Error::UnknownTarget(name.to_owned()))?;
        let actual_len = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if actual_len != entry.length {
            return Err(Error::LengthMismatch {
                name: name.to_owned(),
                expected: entry.length,
                actual: actual_len,
            });
        }
        if !sha256_hex(bytes).eq_ignore_ascii_case(&entry.hashes.sha256) {
            return Err(Error::HashMismatch(name.to_owned()));
        }
        Ok(())
    }
}

/// Compute the [`TargetEntry`] (SHA-256 + length) for some artifact bytes.
#[must_use]
pub fn target_entry(bytes: &[u8]) -> TargetEntry {
    TargetEntry {
        hashes: Hashes {
            sha256: sha256_hex(bytes),
        },
        length: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
    }
}

/// Sign a `signed` body with a role `key`, producing complete metadata.
///
/// Used by the Release Service (P3.3) and by tests; clients only ever verify.
///
/// # Errors
/// Returns [`Error::Json`] if the canonical encoding fails.
pub fn sign_targets(
    signed: SignedTargets,
    keyid: impl Into<String>,
    key: &ReleaseSigningKey,
) -> Result<ReleaseMetadata> {
    let signature = Signature {
        keyid: keyid.into(),
        sig: B64.encode(key.sign(&signed.canonical_bytes()?)),
    };
    Ok(ReleaseMetadata {
        signed,
        signatures: vec![signature],
    })
}

/// Lower-case hex SHA-256 of `bytes`.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_encode(&hasher.finalize())
}

/// Encode bytes as lower-case hexadecimal.
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}
