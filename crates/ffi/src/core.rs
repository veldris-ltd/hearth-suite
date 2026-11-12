//! The unified core facade the bindings expose to the UI.

use std::path::Path;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use uuid::Uuid;

use hearth_crdt_sync::SyncConfig;
use hearth_ember_bridge::{Context, Effort, Ember, InferenceBackend, ModelTier, Task};
use hearth_key_manager::RecoveryPhrase;
use hearth_legacy_import::{decode_bytes, Decoded, LegacyFormat};
use hearth_lexicon::Lexicon;
use hearth_seal::{seal, unseal, verify, Grant, Identity, PublicIdentity, SealedBundle};
use hearth_store::models::{DocType, RecordRow, RecordValue, RowValues};
use hearth_store::Store;
use serde_json::{json, Value};

use crate::dto::{
    BundleSummary, CreateBundleRequest, DocTypeDto, DocumentContent, DocumentSummary, EffortDto,
    EmberRequest, EmberResponse, EmberTierDto, FieldInfo, FieldValue, GrantDto, InsertRowRequest,
    PreferenceEntry, RecordRowDto, RecordValueDto, SaveDocumentRequest, SealRequest, SealedDto,
    SyncStatus, TableSummary, TaskDto, UpdateRowRequest,
};
use crate::error::{Error, Result};

/// The unified Hearth Suite core: the single object the bindings drive.
///
/// Wraps the local [`Store`], the user's Seal [`Identity`], and an [`Ember`]
/// inference session, exposing the full surface, open/save Bundle, seal/unseal,
/// run Ember, query Records, and sync controls, through serializable DTOs.
pub struct HearthCore {
    store: Store,
    identity: Identity,
    ember: Ember<Box<dyn InferenceBackend>>,
    sync: SyncConfig,
    /// The BIP-39 recovery phrase for this identity's master seed, kept so the
    /// onboarding flow can show the real words (seam #7).
    recovery_phrase: String,
    /// The offline dictionary/thesaurus (seam #9). The embedded CC0 sample here;
    /// a production build loads the full WordNet/Wiktionary dataset.
    lexicon: Lexicon,
}

impl HearthCore {
    /// Open the core at `path`, deriving the user's identity from `identity_seed`
    /// and using `backend` for on-device inference.
    ///
    /// # Errors
    /// Returns an error if the store cannot be opened or the identity derived.
    pub fn open(
        path: &Path,
        identity_seed: &[u8; 32],
        backend: Box<dyn InferenceBackend>,
    ) -> Result<Self> {
        let store = Store::open(path, identity_seed)?;
        let identity = Identity::from_seed(identity_seed)?;
        let recovery_phrase = RecoveryPhrase::from_seed(identity_seed)?
            .as_str()
            .to_owned();
        let ember = Ember::new(backend);
        Ok(Self {
            store,
            identity,
            ember,
            sync: SyncConfig::default(),
            recovery_phrase,
            lexicon: Lexicon::sample(),
        })
    }

    /// Open the core by restoring an identity from its BIP-39 recovery phrase.
    ///
    /// Parses and validates the phrase, recovers the 32-byte master seed, and
    /// opens exactly as [`open`](Self::open) would, so a fresh device rebuilds
    /// the identical identity and can open the same sealed Bundles (seam #7).
    ///
    /// # Errors
    /// Returns an error if the phrase is not a valid recovery phrase, or if the
    /// store cannot be opened or the identity derived.
    pub fn open_from_phrase(
        path: &Path,
        phrase: &str,
        backend: Box<dyn InferenceBackend>,
    ) -> Result<Self> {
        let seed = RecoveryPhrase::parse(phrase)?.to_seed()?;
        Self::open(path, &seed, backend)
    }

    /// This identity's recovery phrase (24 BIP-39 words), to show once during
    /// onboarding so the user can back it up.
    pub fn recovery_phrase(&self) -> &str {
        &self.recovery_phrase
    }

    // ---- bundles & documents ----------------------------------------------

    /// Create a new Bundle.
    ///
    /// # Errors
    /// Returns an error if the store write fails.
    pub fn create_bundle(&self, req: &CreateBundleRequest) -> Result<BundleSummary> {
        let id = self.store.create_bundle(&req.title, b"{}")?;
        let updated_at = self
            .store
            .get_bundle(id)?
            .map(|b| unix_to_rfc3339(b.updated_at));
        Ok(BundleSummary {
            id: id.to_string(),
            title: req.title.clone(),
            sealed: false,
            document_count: 0,
            updated_at,
        })
    }

    /// List all Bundles.
    ///
    /// # Errors
    /// Returns an error if the store read fails.
    pub fn list_bundles(&self) -> Result<Vec<BundleSummary>> {
        let mut out = Vec::new();
        for bundle in self.store.list_bundles()? {
            let count = self.store.list_documents(bundle.id)?.len();
            out.push(BundleSummary {
                id: bundle.id.to_string(),
                title: bundle.title,
                sealed: bundle.sealed,
                document_count: u32::try_from(count).unwrap_or(u32::MAX),
                updated_at: Some(unix_to_rfc3339(bundle.updated_at)),
            });
        }
        Ok(out)
    }

    /// List the Records tables in a Bundle (for universal search).
    ///
    /// # Errors
    /// Returns an error if the id is invalid or the store read fails.
    pub fn list_tables(&self, bundle_id: &str) -> Result<Vec<TableSummary>> {
        Ok(self
            .store
            .list_tables(parse_uuid(bundle_id)?)?
            .into_iter()
            .map(|t| TableSummary {
                id: t.id.to_string(),
                name: t.name,
            })
            .collect())
    }

    /// Save (encrypt to the vault) a document in a Bundle.
    ///
    /// # Errors
    /// Returns an error if the id is invalid, the content is not base64, or the
    /// store write fails.
    pub fn save_document(&self, req: &SaveDocumentRequest) -> Result<DocumentSummary> {
        let bundle_id = parse_uuid(&req.bundle_id)?;
        let content = decode_b64(&req.content_base64)?;
        let title = req.title.clone().unwrap_or_default();
        let id = self
            .store
            .put_document(bundle_id, doc_type(req.doc_type), &title, &content)?;
        Ok(DocumentSummary {
            id: id.to_string(),
            doc_type: req.doc_type,
            title,
        })
    }

    /// List the documents in a Bundle, in their Portfolio order (seam #1). Used
    /// to enumerate Sheets as a Mailings data source and to show Bundle contents.
    ///
    /// # Errors
    /// Returns an error if the id is invalid or the store read fails.
    pub fn list_documents(&self, bundle_id: &str) -> Result<Vec<DocumentSummary>> {
        Ok(self
            .store
            .list_documents(parse_uuid(bundle_id)?)?
            .into_iter()
            .map(|d| DocumentSummary {
                id: d.id.to_string(),
                doc_type: doc_type_dto(d.doc_type),
                title: d.title,
            })
            .collect())
    }

    /// Reorder a Bundle's documents (the Portfolio drag-reorder, seam #1).
    ///
    /// # Errors
    /// Returns an error if any id is invalid or the store write fails.
    pub fn reorder_documents(&self, bundle_id: &str, order: &[String]) -> Result<()> {
        let bundle = parse_uuid(bundle_id)?;
        let ids = order
            .iter()
            .map(|s| parse_uuid(s))
            .collect::<Result<Vec<_>>>()?;
        self.store.reorder_documents(bundle, &ids)?;
        Ok(())
    }

    /// Open (decrypt from the vault) a document's content.
    ///
    /// # Errors
    /// Returns an error if the id is invalid or the document cannot be read.
    pub fn open_document(&self, document_id: &str) -> Result<DocumentContent> {
        let id = parse_uuid(document_id)?;
        let bytes = self.store.read_document(id)?;
        Ok(DocumentContent {
            content_base64: B64.encode(bytes),
        })
    }

    // ---- legacy import -----------------------------------------------------

    /// Decode a legacy Works file (`.wps`/`.wks`/`.wdb`) into the translator's
    /// intermediate representation (seam #12). `format` is `wps`/`wks`/`wdb`;
    /// `content_base64` is the file's bytes. Routed through the standard dispatch
    /// so the desktop and mobile hosts decode real files, not just samples.
    ///
    /// # Errors
    /// Returns an error if the base64 is invalid or the format is unknown.
    pub fn decode_legacy(&self, format: &str, content_base64: &str) -> Result<Value> {
        let bytes = decode_b64(content_base64)?;
        let fmt = LegacyFormat::from_extension(format)
            .ok_or_else(|| Error::InvalidRequest(format!("unknown legacy format: {format}")))?;
        Ok(legacy_ir(fmt, &decode_bytes(&bytes, fmt)))
    }

    // ---- lexicon (seam #9) -------------------------------------------------

    /// The full offline lexicon dataset as a `{ word: record }` map, so the
    /// client hydrates its dictionary/thesaurus from the core through the FFI
    /// (seam #9). The embedded CC0 sample here; production returns the full
    /// WordNet/Wiktionary set behind the identical shape.
    ///
    /// # Errors
    /// Returns an error only if the entry map cannot be serialised.
    pub fn lexicon_dataset(&self) -> Result<Value> {
        Ok(serde_json::to_value(self.lexicon.entries())?)
    }

    // ---- preferences -------------------------------------------------------

    /// Persist a user preference (theme, Ember effort, Sheets style sets, ...)
    /// in the vault-encrypted store, so it travels with sync.
    ///
    /// # Errors
    /// Returns an error if the value cannot be encrypted or written.
    pub fn set_preference(&self, key: &str, value: &str) -> Result<()> {
        self.store.set_preference(key, value)?;
        Ok(())
    }

    /// Read a stored preference, or `None` if unset.
    ///
    /// # Errors
    /// Returns an error if the value cannot be decrypted or read.
    pub fn get_preference(&self, key: &str) -> Result<Option<String>> {
        Ok(self.store.get_preference(key)?)
    }

    /// List every stored preference, so the client can hydrate its cache.
    ///
    /// # Errors
    /// Returns an error if any value cannot be decrypted or read.
    pub fn list_preferences(&self) -> Result<Vec<PreferenceEntry>> {
        Ok(self
            .store
            .list_preferences()?
            .into_iter()
            .map(|(key, value)| PreferenceEntry { key, value })
            .collect())
    }

    // ---- seal / unseal -----------------------------------------------------

    /// This core's public identity (base64), to share with senders.
    pub fn identity_public(&self) -> String {
        B64.encode(self.identity.public().to_bytes())
    }

    /// Seal content for the given recipients, signed by this identity.
    ///
    /// # Errors
    /// Returns an error if any input is malformed or sealing fails.
    pub fn seal(&self, req: &SealRequest) -> Result<SealedDto> {
        let content = decode_b64(&req.content_base64)?;
        let mut recipients = Vec::with_capacity(req.recipient_public_keys.len());
        for key in &req.recipient_public_keys {
            recipients.push(PublicIdentity::from_bytes(&decode_b64(key)?)?);
        }
        let sealed = seal(
            b"hearth-bundle-manifest",
            &content,
            &recipients,
            &self.identity,
        )?;
        Ok(sealed_to_dto(&sealed))
    }

    /// Unseal a Bundle addressed to this identity, returning the content.
    ///
    /// # Errors
    /// Returns an error if the DTO is malformed or unsealing fails.
    pub fn unseal(&self, dto: &SealedDto) -> Result<DocumentContent> {
        let sealed = dto_to_sealed(dto)?;
        let content = unseal(&sealed, &self.identity)?;
        Ok(DocumentContent {
            content_base64: B64.encode(content),
        })
    }

    /// Verify a sealed Bundle's signature against a signer's public identity.
    ///
    /// # Errors
    /// Returns an error if the DTO or signer key is malformed.
    pub fn verify(&self, dto: &SealedDto, signer_public_base64: &str) -> Result<bool> {
        let sealed = dto_to_sealed(dto)?;
        let signer = PublicIdentity::from_bytes(&decode_b64(signer_public_base64)?)?;
        Ok(verify(&sealed, &signer).is_ok())
    }

    // ---- Ember -------------------------------------------------------------

    /// Run an Ember request and collect the (device-local) completion.
    ///
    /// # Errors
    /// Returns an error if inference fails.
    pub fn run_ember(&self, req: &EmberRequest) -> Result<EmberResponse> {
        let context = Context::new(req.request.clone()).with_document(req.document.clone());
        let generation = self.ember.run(task(req.task), &context, effort(req.effort));
        let device_local = generation.is_device_local();
        let text = futures::executor::block_on(generation.collect_text())?;
        Ok(EmberResponse {
            text,
            model: self.ember.model().name().to_owned(),
            device_local,
        })
    }

    /// The on-device Ember model tiers available, smallest first.
    ///
    /// Mobile clients default to the `mobile_default` tier (smallest viable Phi)
    /// and offer heavier tiers only as a Wi-Fi-gated, consented download
    /// (`AC-MOB-2`).
    pub fn ember_tiers(&self) -> Vec<EmberTierDto> {
        ModelTier::all()
            .into_iter()
            .map(|tier| EmberTierDto {
                id: tier.id().to_owned(),
                name: tier.name().to_owned(),
                gguf: tier.gguf_hint().to_owned(),
                supports_thinking: tier.supports_thinking(),
                min_ram_mb: u32::try_from(tier.min_ram_mb()).unwrap_or(u32::MAX),
                mobile_default: tier.is_mobile_default(),
            })
            .collect()
    }

    // ---- Records -----------------------------------------------------------

    /// Create a Records table.
    ///
    /// # Errors
    /// Returns an error if the Bundle id is invalid or the write fails.
    pub fn create_table(&self, bundle_id: &str, name: &str) -> Result<String> {
        Ok(self
            .store
            .create_table(parse_uuid(bundle_id)?, name)?
            .to_string())
    }

    /// Add a field to a Records table.
    ///
    /// # Errors
    /// Returns an error if the table id is invalid or the write fails.
    pub fn add_field(&self, table_id: &str, name: &str, datatype: &str) -> Result<String> {
        Ok(self
            .store
            .add_field(parse_uuid(table_id)?, name, datatype)?
            .to_string())
    }

    /// Insert a row into a Records table.
    ///
    /// # Errors
    /// Returns an error if any id is invalid or the write fails.
    pub fn insert_row(&self, req: &InsertRowRequest) -> Result<String> {
        let mut values = RowValues::new();
        for field in &req.values {
            values.insert(parse_uuid(&field.field_id)?, record_value(&field.value));
        }
        Ok(self
            .store
            .insert_row(parse_uuid(&req.table_id)?, &values)?
            .to_string())
    }

    /// List a Records table's fields (id, name, type), needed to read rows by
    /// field name (seam #3).
    ///
    /// # Errors
    /// Returns an error if the table id is invalid or the read fails.
    pub fn list_fields(&self, table_id: &str) -> Result<Vec<FieldInfo>> {
        Ok(self
            .store
            .list_fields(parse_uuid(table_id)?)?
            .into_iter()
            .map(|f| FieldInfo {
                id: f.id.to_string(),
                name: f.name,
                datatype: f.datatype,
            })
            .collect())
    }

    /// Query (list) the rows of a Records table.
    ///
    /// # Errors
    /// Returns an error if the table id is invalid or the read fails.
    pub fn query_rows(&self, table_id: &str) -> Result<Vec<RecordRowDto>> {
        Ok(self
            .store
            .list_rows(parse_uuid(table_id)?)?
            .iter()
            .map(row_to_dto)
            .collect())
    }

    /// Update an existing Records row's values, so edits to saved rows persist
    /// (seam #2). Returns the row id (matching the dev mock's lenient contract).
    ///
    /// # Errors
    /// Returns an error if any id is invalid or the write fails.
    pub fn update_row(&self, req: &UpdateRowRequest) -> Result<String> {
        let row_id = parse_uuid(&req.row_id)?;
        let mut values = RowValues::new();
        for field in &req.values {
            values.insert(parse_uuid(&field.field_id)?, record_value(&field.value));
        }
        self.store.update_row(row_id, &values)?;
        Ok(row_id.to_string())
    }

    /// Delete a Records row by id (seam #2).
    ///
    /// # Errors
    /// Returns an error if the id is invalid or the write fails.
    pub fn delete_row(&self, row_id: &str) -> Result<()> {
        self.store.delete_row(parse_uuid(row_id)?)?;
        Ok(())
    }

    // ---- sync controls -----------------------------------------------------

    /// Enable or disable opt-in sync for this core.
    pub fn set_sync_enabled(&mut self, enabled: bool) {
        self.sync.enabled = enabled;
    }

    /// The current sync status (disabled by default).
    pub fn sync_status(&self) -> SyncStatus {
        SyncStatus {
            enabled: self.sync.enabled,
        }
    }
}

// ---- conversions ------------------------------------------------------------

/// Map the portable decode (recovered text blocks + honest notes) into the
/// translator's intermediate representation for the format. The TS `@hearth/
/// legacy` translator then turns this into Hearth Suite models and a fidelity report.
fn legacy_ir(format: LegacyFormat, decoded: &Decoded) -> Value {
    let unsupported: Vec<Value> = decoded
        .notes
        .iter()
        .map(|note| json!({ "kind": "Fidelity", "detail": note }))
        .collect();
    match format {
        LegacyFormat::Wps => {
            let blocks: Vec<Value> = decoded
                .blocks
                .iter()
                .map(|text| json!({ "kind": "paragraph", "style": "Body", "runs": [{ "text": text }] }))
                .collect();
            json!({ "title": "Imported document", "blocks": blocks, "unsupported": unsupported })
        }
        LegacyFormat::Wks => {
            let cells: Vec<Value> = decoded
                .blocks
                .iter()
                .enumerate()
                .map(|(i, text)| json!({ "ref": format!("A{}", i + 1), "value": text }))
                .collect();
            json!({ "name": "Imported Sheet", "cells": cells, "unsupported": unsupported })
        }
        LegacyFormat::Wdb => {
            let rows: Vec<Value> = decoded
                .blocks
                .iter()
                .map(|text| json!({ "Value": text }))
                .collect();
            json!({
                "name": "Imported Records",
                "fields": [{ "name": "Value", "type": "text" }],
                "rows": rows,
                "unsupported": unsupported,
            })
        }
    }
}

fn parse_uuid(s: &str) -> Result<Uuid> {
    Uuid::parse_str(s).map_err(|e| Error::InvalidId(format!("{s:?}: {e}")))
}

fn decode_b64(s: &str) -> Result<Vec<u8>> {
    B64.decode(s).map_err(|e| Error::Base64(e.to_string()))
}

fn fixed<const N: usize>(bytes: &[u8]) -> Result<[u8; N]> {
    bytes
        .try_into()
        .map_err(|_| Error::InvalidRequest(format!("expected {N} bytes")))
}

fn doc_type(dto: DocTypeDto) -> DocType {
    match dto {
        DocTypeDto::Writer => DocType::Writer,
        DocTypeDto::Sheet => DocType::Sheet,
        DocTypeDto::Record => DocType::Record,
        DocTypeDto::Calendar => DocType::Calendar,
        DocTypeDto::Chart => DocType::Chart,
    }
}

fn doc_type_dto(ty: DocType) -> DocTypeDto {
    match ty {
        DocType::Writer => DocTypeDto::Writer,
        DocType::Sheet => DocTypeDto::Sheet,
        DocType::Record => DocTypeDto::Record,
        DocType::Calendar => DocTypeDto::Calendar,
        DocType::Chart => DocTypeDto::Chart,
    }
}

/// Format Unix seconds as an RFC 3339 / ISO 8601 UTC timestamp, e.g.
/// `2026-06-09T16:20:00Z`. Dependency-free civil-date conversion (Howard
/// Hinnant's `civil_from_days` algorithm) so The Mantel's History date and
/// recency sort (AC-WKS-S3) work without pulling in a date crate.
fn unix_to_rfc3339(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (hour, min, sec) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    // days since 1970-01-01 → civil (year, month, day).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}Z")
}

fn task(dto: TaskDto) -> Task {
    match dto {
        TaskDto::Draft => Task::Draft,
        TaskDto::Summarize => Task::Summarize,
        TaskDto::Rewrite => Task::Rewrite,
        TaskDto::Continue => Task::Continue,
        TaskDto::Formula => Task::Formula,
        TaskDto::Query => Task::Query,
    }
}

fn effort(dto: EffortDto) -> Effort {
    match dto {
        EffortDto::Fast => Effort::Fast,
        EffortDto::Balanced => Effort::Balanced,
        EffortDto::Thorough => Effort::Thorough,
    }
}

fn record_value(dto: &RecordValueDto) -> RecordValue {
    match dto {
        RecordValueDto::Text(t) => RecordValue::Text(t.clone()),
        RecordValueDto::Number(n) => RecordValue::Number(*n),
        RecordValueDto::Integer(i) => RecordValue::Integer(*i),
        RecordValueDto::Bool(b) => RecordValue::Bool(*b),
        RecordValueDto::Null => RecordValue::Null,
    }
}

fn record_value_dto(value: &RecordValue) -> RecordValueDto {
    match value {
        RecordValue::Text(t) => RecordValueDto::Text(t.clone()),
        RecordValue::Number(n) => RecordValueDto::Number(*n),
        RecordValue::Integer(i) => RecordValueDto::Integer(*i),
        RecordValue::Bool(b) => RecordValueDto::Bool(*b),
        RecordValue::Null => RecordValueDto::Null,
    }
}

fn row_to_dto(row: &RecordRow) -> RecordRowDto {
    RecordRowDto {
        id: row.id.to_string(),
        values: row
            .values
            .iter()
            .map(|(field_id, value)| FieldValue {
                field_id: field_id.to_string(),
                value: record_value_dto(value),
            })
            .collect(),
    }
}

fn sealed_to_dto(sealed: &SealedBundle) -> SealedDto {
    SealedDto {
        manifest_base64: B64.encode(&sealed.manifest),
        content_base64: B64.encode(&sealed.content),
        signature_base64: B64.encode(&sealed.signature),
        grants: sealed
            .grants
            .iter()
            .map(|g| GrantDto {
                recipient_id_base64: B64.encode(g.recipient_id),
                ephemeral_public_base64: B64.encode(g.ephemeral_x25519_public),
                kem_ciphertext_base64: B64.encode(&g.kem_ciphertext),
                wrapped_key_base64: B64.encode(&g.wrapped_content_key),
            })
            .collect(),
    }
}

fn dto_to_sealed(dto: &SealedDto) -> Result<SealedBundle> {
    let mut grants = Vec::with_capacity(dto.grants.len());
    for g in &dto.grants {
        grants.push(Grant {
            recipient_id: fixed::<16>(&decode_b64(&g.recipient_id_base64)?)?,
            ephemeral_x25519_public: fixed::<32>(&decode_b64(&g.ephemeral_public_base64)?)?,
            kem_ciphertext: decode_b64(&g.kem_ciphertext_base64)?,
            wrapped_content_key: decode_b64(&g.wrapped_key_base64)?,
        });
    }
    Ok(SealedBundle {
        manifest: decode_b64(&dto.manifest_base64)?,
        content: decode_b64(&dto.content_base64)?,
        grants,
        signature: decode_b64(&dto.signature_base64)?,
    })
}
