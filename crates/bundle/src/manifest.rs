//! The Bundle manifest: the signed JSON index of a Bundle's contents.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;

/// The current manifest schema version.
pub const SPEC_VERSION: u32 = 1;

/// The kind of a Hearth Suite document, mapping to the four modules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocType {
    /// A Writer (word-processing) document.
    Writer,
    /// A Sheets (spreadsheet) document.
    Sheet,
    /// A Records (database) document.
    Record,
    /// A Calendar document.
    Calendar,
}

/// A document held in a Bundle, referenced by container path and content hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentEntry {
    /// Stable document identifier.
    pub id: Uuid,
    /// Human-readable title.
    pub title: String,
    /// The module this document belongs to.
    pub doc_type: DocType,
    /// Path of the document within the container (e.g. `documents/<id>.odt`).
    pub path: String,
    /// IANA media type of the stored bytes.
    pub media_type: String,
    /// Lowercase hex SHA-256 of the stored bytes (integrity check).
    pub sha256: String,
    /// Size of the stored bytes, in bytes.
    pub size: u64,
}

/// A linked data source or asset held in a Bundle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceEntry {
    /// Stable resource identifier.
    pub id: Uuid,
    /// Resource name.
    pub name: String,
    /// Path of the resource within the container.
    pub path: String,
    /// IANA media type of the stored bytes.
    pub media_type: String,
    /// Lowercase hex SHA-256 of the stored bytes (integrity check).
    pub sha256: String,
    /// Size of the stored bytes, in bytes.
    pub size: u64,
}

/// A detached signature over the manifest's canonical bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signature {
    /// Signature algorithm identifier (e.g. `hmac-sha256`; `ml-dsa-65` in P1.4).
    pub algorithm: String,
    /// Identifier of the signing key.
    pub key_id: String,
    /// Lowercase hex of the signature value.
    pub value: String,
}

/// The Bundle manifest, the signed index of everything in the container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    /// Manifest schema version.
    pub spec_version: u32,
    /// Stable Bundle identifier.
    pub id: Uuid,
    /// Bundle title.
    pub title: String,
    /// Documents held in the Bundle.
    pub documents: Vec<DocumentEntry>,
    /// Linked data sources held in the Bundle.
    pub data_sources: Vec<ResourceEntry>,
    /// Assets held in the Bundle.
    pub assets: Vec<ResourceEntry>,
    /// Whether the Bundle's content is sealed (post-quantum encrypted).
    pub sealed: bool,
    /// Creation time, seconds since the Unix epoch.
    pub created_at: u64,
    /// Last-modified time, seconds since the Unix epoch.
    pub updated_at: u64,
    /// Detached signatures over the manifest (see [`Manifest::signing_bytes`]).
    pub signatures: Vec<Signature>,
}

impl Manifest {
    /// Create an empty manifest with the given id, title, and timestamp.
    pub fn new(id: Uuid, title: impl Into<String>, now: u64) -> Self {
        Self {
            spec_version: SPEC_VERSION,
            id,
            title: title.into(),
            documents: Vec::new(),
            data_sources: Vec::new(),
            assets: Vec::new(),
            sealed: false,
            created_at: now,
            updated_at: now,
            signatures: Vec::new(),
        }
    }

    /// The canonical bytes that signatures are computed over: the manifest
    /// serialized as JSON with its `signatures` field emptied.
    ///
    /// # Errors
    /// Returns an error if serialization fails.
    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        let mut unsigned = self.clone();
        unsigned.signatures.clear();
        Ok(serde_json::to_vec(&unsigned)?)
    }
}
