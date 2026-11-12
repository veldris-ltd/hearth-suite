/**
 * Typed TypeScript client for the Hearth Suite core.
 *
 * The canonical request/response types are generated from the Rust DTOs by
 * `ts-rs` into `crates/ffi/bindings/`. They are mirrored here so the client
 * type-checks standalone in the JS workspace; both describe the same surface
 * exposed by the native C-ABI and the WASM bindings.
 */

export type DocType = "writer" | "sheet" | "record" | "calendar" | "chart";
export type Task = "draft" | "summarize" | "rewrite" | "continue" | "formula" | "query";
export type Effort = "fast" | "balanced" | "thorough";

export interface BundleSummary {
  id: string;
  title: string;
  sealed: boolean;
  document_count: number;
  /**
   * When the Bundle was last touched (ISO 8601). Drives The Mantel's History
   * date and recency sort (AC-WKS-S3). Both the Rust core (RFC 3339 UTC) and the
   * dev mock populate it; optional so the UI still degrades gracefully (shows
   * the device cue) if it is ever absent.
   */
  updated_at?: string;
}

export interface CreateBundleRequest {
  title: string;
}

export interface TableSummary {
  id: string;
  name: string;
}

export interface SaveDocumentRequest {
  bundle_id: string;
  doc_type: DocType;
  content_base64: string;
  /** A human title for the document (shown in the Bundle contents). */
  title?: string;
}

export interface DocumentSummary {
  id: string;
  doc_type: DocType;
  title?: string;
}

export interface DocumentContent {
  content_base64: string;
}

export interface EmberRequest {
  task: Task;
  document: string;
  request: string;
  effort: Effort;
}

export interface EmberResponse {
  text: string;
  model: string;
  device_local: boolean;
}

export interface EmberTier {
  id: string;
  name: string;
  gguf: string;
  supports_thinking: boolean;
  min_ram_mb: number;
  mobile_default: boolean;
}

export interface GrantDto {
  recipient_id_base64: string;
  ephemeral_public_base64: string;
  kem_ciphertext_base64: string;
  wrapped_key_base64: string;
}

export interface SealedDto {
  manifest_base64: string;
  content_base64: string;
  grants: GrantDto[];
  signature_base64: string;
}

export interface SealRequest {
  content_base64: string;
  recipient_public_keys: string[];
}

export type RecordValue =
  | { text: string }
  | { number: number }
  | { integer: number }
  | { bool: boolean }
  | "null";

export interface FieldValue {
  field_id: string;
  value: RecordValue;
}

export interface InsertRowRequest {
  table_id: string;
  values: FieldValue[];
}

export interface UpdateRowRequest {
  row_id: string;
  values: FieldValue[];
}

export interface RecordRow {
  id: string;
  values: FieldValue[];
}

/** A field's identity and type, as returned by `list_fields`. */
export interface FieldInfo {
  id: string;
  name: string;
  datatype: string;
}

/**
 * One stored lexicon entry (a dictionary/thesaurus record without its key word).
 * Mirrors the `@hearth/lexicon` `LexiconRecord`; returned by `lexicon_dataset`.
 */
export interface LexiconRecord {
  pos?: string;
  definitions: string[];
  synonyms?: string[];
  antonyms?: string[];
}

export interface SyncStatus {
  enabled: boolean;
}

/**
 * One stored preference (key/value, both UTF-8). Mirrors the Rust
 * `PreferenceEntry`; declared by hand rather than generated so a purely
 * additive type doesn't churn every ts-rs binding.
 */
export interface PreferenceEntry {
  key: string;
  value: string;
}

/**
 * Transport that delivers a method call to the core and returns the result.
 *
 * Concrete transports wrap the native C-ABI (`hearth_call`, e.g. via Tauri) or
 * the WASM `Hearth.call` binding.
 */
export interface Transport {
  call<T>(method: string, params: unknown): Promise<T>;
}

/** A typed client over a {@link Transport}. */
export class HearthClient {
  constructor(private readonly transport: Transport) {}

  // ---- bundles & documents --------------------------------------------------
  createBundle(req: CreateBundleRequest): Promise<BundleSummary> {
    return this.transport.call("create_bundle", req);
  }
  listBundles(): Promise<BundleSummary[]> {
    return this.transport.call("list_bundles", {});
  }
  listTables(bundleId: string): Promise<TableSummary[]> {
    return this.transport.call("list_tables", { id: bundleId });
  }
  saveDocument(req: SaveDocumentRequest): Promise<DocumentSummary> {
    return this.transport.call("save_document", req);
  }
  openDocument(id: string): Promise<DocumentContent> {
    return this.transport.call("open_document", { id });
  }
  /** List the documents in a bundle (e.g. to enumerate Sheets as a data source). */
  listDocuments(bundleId: string): Promise<DocumentSummary[]> {
    return this.transport.call("list_documents", { id: bundleId });
  }
  /** Reorder a bundle's documents (the Portfolio drag-reorder). */
  reorderDocuments(bundleId: string, orderedIds: string[]): Promise<null> {
    return this.transport.call("reorder_documents", { id: bundleId, order: orderedIds });
  }

  // ---- identity & recovery --------------------------------------------------
  identityPublic(): Promise<string> {
    return this.transport.call("identity_public", {});
  }
  /**
   * This identity's BIP-39 recovery phrase (24 words), derived from the master
   * seed. Shown once during onboarding so the user can back it up; re-entering
   * it on a fresh device reconstructs the same identity.
   */
  recoveryPhrase(): Promise<string> {
    return this.transport.call("recovery_phrase", {});
  }
  seal(req: SealRequest): Promise<SealedDto> {
    return this.transport.call("seal", req);
  }
  unseal(sealed: SealedDto): Promise<DocumentContent> {
    return this.transport.call("unseal", sealed);
  }
  verify(sealed: SealedDto, signerPublicBase64: string): Promise<boolean> {
    return this.transport.call("verify", { sealed, signer_public_base64: signerPublicBase64 });
  }

  // ---- Ember ----------------------------------------------------------------
  runEmber(req: EmberRequest): Promise<EmberResponse> {
    return this.transport.call("run_ember", req);
  }
  emberTiers(): Promise<EmberTier[]> {
    return this.transport.call("ember_tiers", {});
  }

  // ---- Records --------------------------------------------------------------
  createTable(bundleId: string, name: string): Promise<string> {
    return this.transport.call("create_table", { bundle_id: bundleId, name });
  }
  addField(tableId: string, name: string, datatype: string): Promise<string> {
    return this.transport.call("add_field", { table_id: tableId, name, datatype });
  }
  /** List a table's fields (id, name, type), needed to read rows by field name. */
  listFields(tableId: string): Promise<FieldInfo[]> {
    return this.transport.call("list_fields", { id: tableId });
  }
  insertRow(req: InsertRowRequest): Promise<string> {
    return this.transport.call("insert_row", req);
  }
  /** Update an existing row's values, so edits to saved records persist. */
  updateRow(req: UpdateRowRequest): Promise<string> {
    return this.transport.call("update_row", req);
  }
  /** Delete a row by id. */
  deleteRow(rowId: string): Promise<null> {
    return this.transport.call("delete_row", { id: rowId });
  }
  queryRows(tableId: string): Promise<RecordRow[]> {
    return this.transport.call("query_rows", { id: tableId });
  }

  // ---- preferences ----------------------------------------------------------
  /**
   * Persist a user preference (theme, Ember effort, Sheets style sets, ...) in
   * the vault-encrypted store so it travels with sync. Values are UTF-8 strings
   * (the same shape `localStorage` holds), keys are client-owned.
   */
  setPreference(key: string, value: string): Promise<null> {
    return this.transport.call("set_preference", { key, value });
  }
  /** Read a stored preference, or `null` if it was never set. */
  getPreference(key: string): Promise<string | null> {
    return this.transport.call("get_preference", { key });
  }
  /** List every stored preference, to hydrate an in-memory cache at startup. */
  listPreferences(): Promise<PreferenceEntry[]> {
    return this.transport.call("list_preferences", {});
  }

  // ---- lexicon (seam #9) ----------------------------------------------------
  /**
   * The full offline dictionary/thesaurus dataset (`{ word: record }`), loaded
   * once so the client's Define/lookup surfaces use the production
   * WordNet/Wiktionary set rather than the bundled CC0 sample. Fully local — the
   * core reads it from on-device storage, never the network.
   */
  lexiconDataset(): Promise<Record<string, LexiconRecord>> {
    return this.transport.call("lexicon_dataset", {});
  }

  // ---- legacy import --------------------------------------------------------
  /**
   * Decode a legacy Works file (`.wps`/`.wks`/`.wdb`) into the translator's
   * intermediate representation (seam #12). `format` is `wps`/`wks`/`wdb`;
   * `contentBase64` is the file's bytes. The shape is `WpsIr | WksIr | WdbIr`
   * from `@hearth/legacy` (returned as `unknown` to avoid a package dependency).
   */
  decodeLegacy(format: string, contentBase64: string): Promise<unknown> {
    return this.transport.call("decode_legacy", { format, content_base64: contentBase64 });
  }

  // ---- sync controls --------------------------------------------------------
  setSyncEnabled(enabled: boolean): Promise<null> {
    return this.transport.call("set_sync_enabled", { enabled });
  }
  syncStatus(): Promise<SyncStatus> {
    return this.transport.call("sync_status", {});
  }
}
