//! Typed rows for the store's data model (diagram `05_er`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The module a document belongs to (`DOCUMENT.type` in the ER model).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocType {
    /// Writer (word-processing).
    Writer,
    /// Sheets (spreadsheet).
    Sheet,
    /// Records (database).
    Record,
    /// Calendar.
    Calendar,
    /// Persisted chart-source data for a Writer live-link (keyed by source).
    Chart,
}

impl DocType {
    /// The string stored in the database.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Writer => "writer",
            Self::Sheet => "sheet",
            Self::Record => "record",
            Self::Calendar => "calendar",
            Self::Chart => "chart",
        }
    }

    /// Parse a database string into a [`DocType`].
    pub fn from_db_str(s: &str) -> Option<Self> {
        match s {
            "writer" => Some(Self::Writer),
            "sheet" => Some(Self::Sheet),
            "record" => Some(Self::Record),
            "calendar" => Some(Self::Calendar),
            "chart" => Some(Self::Chart),
            _ => None,
        }
    }
}

/// A user identity (`IDENTITY`). Private key material is stored encrypted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// Stable identity id.
    pub id: Uuid,
    /// Post-quantum public key bytes.
    pub pq_public_key: Vec<u8>,
    /// Encrypted post-quantum private key bytes.
    pub pq_private_key_encrypted: Vec<u8>,
    /// Hash of the recovery phrase.
    pub recovery_phrase_hash: String,
}

/// A paired device (`DEVICE`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Device {
    /// Stable device id.
    pub id: Uuid,
    /// Owning identity.
    pub identity_id: Uuid,
    /// Platform label (e.g. `"windows"`, `"android"`).
    pub platform: String,
}

/// A bundle metadata row (`BUNDLE`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleRow {
    /// Bundle id.
    pub id: Uuid,
    /// Title.
    pub title: String,
    /// Signed bundle manifest bytes (metadata only, never document content).
    pub manifest: Vec<u8>,
    /// Whether the bundle is sealed.
    pub sealed: bool,
    /// Last-modified time (Unix seconds).
    pub updated_at: i64,
}

/// A document metadata row (`DOCUMENT`). Content lives in the vault, not here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentRow {
    /// Document id.
    pub id: Uuid,
    /// Owning bundle.
    pub bundle_id: Uuid,
    /// Module type.
    pub doc_type: DocType,
    /// Human title (shown in the Bundle contents; may be empty).
    pub title: String,
    /// Last-modified time (Unix seconds).
    pub updated_at: i64,
}

/// A Records table (`RECORD_TABLE`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordTable {
    /// Table id.
    pub id: Uuid,
    /// Owning bundle.
    pub bundle_id: Uuid,
    /// Table name.
    pub name: String,
}

/// A Records field/column (`RECORD_FIELD`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordField {
    /// Field id.
    pub id: Uuid,
    /// Owning table.
    pub table_id: Uuid,
    /// Field name.
    pub name: String,
    /// Declared datatype (e.g. `"text"`, `"number"`, `"date"`).
    pub datatype: String,
}

/// A single value in a Records row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordValue {
    /// Text value.
    Text(String),
    /// Floating-point number.
    Number(f64),
    /// Integer.
    Integer(i64),
    /// Boolean.
    Bool(bool),
    /// Empty/null value.
    Null,
}

/// The values of a Records row, keyed by field id.
pub type RowValues = BTreeMap<Uuid, RecordValue>;

/// A Records row (`RECORD_ROW`).
#[derive(Debug, Clone, PartialEq)]
pub struct RecordRow {
    /// Row id.
    pub id: Uuid,
    /// Owning table.
    pub table_id: Uuid,
    /// Field values.
    pub values: RowValues,
}
