//! Data-transfer objects for the binding surface.
//!
//! Every type derives [`serde`] (for JSON over the C-ABI and `serde-wasm-bindgen`
//! over WASM) and [`ts_rs::TS`], which generates matching TypeScript types into
//! `crates/ffi/bindings/` when the test suite runs (`AC-FFI-1`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The module a document belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "snake_case")]
pub enum DocTypeDto {
    /// Writer document.
    Writer,
    /// Sheets document.
    Sheet,
    /// Records document.
    Record,
    /// Calendar document.
    Calendar,
    /// Persisted chart-source data for a Writer live-link (keyed by source).
    Chart,
}

/// Summary of a Bundle.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct BundleSummary {
    /// Bundle id (UUID string).
    pub id: String,
    /// Title.
    pub title: String,
    /// Whether the Bundle is sealed.
    pub sealed: bool,
    /// Number of documents in the Bundle.
    pub document_count: u32,
    /// When the Bundle was last touched (ISO 8601 / RFC 3339 UTC). Drives The
    /// Mantel's History date + recency sort (AC-WKS-S3). `None` only if the
    /// timestamp is unreadable; the core populates it for every Bundle.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub updated_at: Option<String>,
}

/// Request to create a Bundle.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct CreateBundleRequest {
    /// Title for the new Bundle.
    pub title: String,
}

/// Summary of a Records table (for universal search and navigation).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct TableSummary {
    /// Table id (UUID string).
    pub id: String,
    /// Table name.
    pub name: String,
}

/// Request to save a document into a Bundle (content base64-encoded).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct SaveDocumentRequest {
    /// Target Bundle id.
    pub bundle_id: String,
    /// Document module type.
    pub doc_type: DocTypeDto,
    /// Base64-encoded document content.
    pub content_base64: String,
    /// A human title for the document (shown in the Bundle contents). Optional;
    /// defaults to empty when the caller doesn't supply one.
    #[serde(default)]
    #[ts(optional)]
    pub title: Option<String>,
}

/// Summary of a saved document.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct DocumentSummary {
    /// Document id (UUID string).
    pub id: String,
    /// Document module type.
    pub doc_type: DocTypeDto,
    /// Human title (shown in the Bundle contents; may be empty).
    pub title: String,
}

/// Base64-encoded document content.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct DocumentContent {
    /// Base64-encoded content bytes.
    pub content_base64: String,
}

/// One stored preference (key/value, both UTF-8). Returned by `list_preferences`
/// so the client can hydrate its in-memory cache. No `ts_rs` binding: the
/// client declares the matching shape by hand to avoid regenerating every
/// binding (and the CRLF churn that brings) for a purely additive type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreferenceEntry {
    /// The preference key (client-owned, e.g. `hb-theme`).
    pub key: String,
    /// The stored value (UTF-8).
    pub value: String,
}

/// The kind of Ember assistance.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "snake_case")]
pub enum TaskDto {
    /// Draft prose.
    Draft,
    /// Summarise.
    Summarize,
    /// Rewrite the selection.
    Rewrite,
    /// Continue the document.
    Continue,
    /// Produce a spreadsheet formula.
    Formula,
    /// Answer a question.
    Query,
}

/// The Fast/Balanced/Thorough effort control.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "snake_case")]
pub enum EffortDto {
    /// Fast.
    Fast,
    /// Balanced.
    Balanced,
    /// Thorough.
    Thorough,
}

/// Request to run Ember.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct EmberRequest {
    /// The assistance task.
    pub task: TaskDto,
    /// The active document text.
    pub document: String,
    /// The user's natural-language request.
    pub request: String,
    /// Effort level.
    pub effort: EffortDto,
}

/// Ember's response (collected; labelled device-local).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct EmberResponse {
    /// The generated text.
    pub text: String,
    /// The model tier that produced it.
    pub model: String,
    /// Always true: inference ran on-device.
    pub device_local: bool,
}

/// An available on-device Ember model tier (for mobile memory-aware selection).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct EmberTierDto {
    /// Stable tier id (e.g. `phi3_mini`).
    pub id: String,
    /// Human-readable model name.
    pub name: String,
    /// GGUF weights filename hint to download/load.
    pub gguf: String,
    /// Whether the tier supports an explicit thinking budget.
    pub supports_thinking: bool,
    /// Minimum system RAM (MB) the tier needs.
    pub min_ram_mb: u32,
    /// Whether this is the default tier on constrained mobile devices.
    pub mobile_default: bool,
}

/// One recipient grant of a sealed Bundle.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct GrantDto {
    /// Recipient identity id (base64).
    pub recipient_id_base64: String,
    /// Ephemeral X25519 public key (base64).
    pub ephemeral_public_base64: String,
    /// ML-KEM ciphertext (base64).
    pub kem_ciphertext_base64: String,
    /// Wrapped content key (base64).
    pub wrapped_key_base64: String,
}

/// A sealed Bundle, fully base64-encoded for transport.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct SealedDto {
    /// Signed manifest bytes (base64).
    pub manifest_base64: String,
    /// Encrypted content (base64).
    pub content_base64: String,
    /// Per-recipient grants.
    pub grants: Vec<GrantDto>,
    /// ML-DSA signature (base64).
    pub signature_base64: String,
}

/// Request to seal content for recipients.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct SealRequest {
    /// Base64-encoded content to seal.
    pub content_base64: String,
    /// Recipient public identities (base64 of `PublicIdentity` bytes).
    pub recipient_public_keys: Vec<String>,
}

/// Request to create a Records table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct CreateTableRequest {
    /// Owning Bundle id.
    pub bundle_id: String,
    /// Table name.
    pub name: String,
}

/// Request to add a field to a table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct AddFieldRequest {
    /// Owning table id.
    pub table_id: String,
    /// Field name.
    pub name: String,
    /// Declared datatype.
    pub datatype: String,
}

/// A Records value.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "snake_case")]
pub enum RecordValueDto {
    /// Text value.
    Text(String),
    /// Floating-point number.
    Number(f64),
    /// Integer.
    Integer(i64),
    /// Boolean.
    Bool(bool),
    /// Empty value.
    Null,
}

/// A single field value within a row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct FieldValue {
    /// Field id.
    pub field_id: String,
    /// The value.
    pub value: RecordValueDto,
}

/// Request to insert a Records row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct InsertRowRequest {
    /// Owning table id.
    pub table_id: String,
    /// Field values for the row.
    pub values: Vec<FieldValue>,
}

/// Request to update an existing Records row's values (seam #2).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct UpdateRowRequest {
    /// The row to update.
    pub row_id: String,
    /// The new field values for the row.
    pub values: Vec<FieldValue>,
}

/// A Records field's identity and type, as returned by `list_fields` (seam #3).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct FieldInfo {
    /// Field id (UUID string).
    pub id: String,
    /// Field name.
    pub name: String,
    /// Declared datatype (e.g. `"text"`, `"number"`).
    pub datatype: String,
}

/// A Records row returned from a query.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct RecordRowDto {
    /// Row id.
    pub id: String,
    /// Field values.
    pub values: Vec<FieldValue>,
}

/// Sync controls / status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct SyncStatus {
    /// Whether opt-in sync is enabled (off by default).
    pub enabled: bool,
}
