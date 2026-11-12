//! The local store: SQLite metadata + Records, and the encrypted document vault.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::models::{
    BundleRow, Device, DocType, DocumentRow, Identity, RecordField, RecordRow, RecordTable,
    RecordValue, RowValues,
};
use crate::schema::apply_migrations;
use crate::vault::{IdentityCipher, VaultCipher};

const DB_FILE: &str = "hearth.db";
const VAULT_DIR: &str = "vault";

/// A fully offline, zero-configuration local store.
///
/// Metadata and Records live in an embedded SQLite database; document content
/// lives in an encrypted vault directory alongside it.
pub struct Store {
    conn: Connection,
    root: PathBuf,
    cipher: Box<dyn VaultCipher>,
}

impl Store {
    /// Open (creating if absent) a store rooted at `root`, deriving the vault
    /// key from the user identity secret.
    ///
    /// # Errors
    /// Returns an error if directories cannot be created or the database cannot
    /// be opened or migrated.
    pub fn open(root: &Path, identity_secret: &[u8]) -> Result<Self> {
        Self::open_with_cipher(
            root,
            Box::new(IdentityCipher::from_identity_secret(identity_secret)),
        )
    }

    /// Open a store with an explicit [`VaultCipher`] (e.g. one provided by the
    /// `seal` crate).
    ///
    /// # Errors
    /// Returns an error if directories cannot be created or the database cannot
    /// be opened or migrated.
    pub fn open_with_cipher(root: &Path, cipher: Box<dyn VaultCipher>) -> Result<Self> {
        fs::create_dir_all(root)?;
        fs::create_dir_all(root.join(VAULT_DIR))?;
        let conn = Connection::open(root.join(DB_FILE))?;
        apply_migrations(&conn)?;
        Ok(Self {
            conn,
            root: root.to_path_buf(),
            cipher,
        })
    }

    fn vault_path(&self, vault_key: &str) -> PathBuf {
        self.root.join(VAULT_DIR).join(format!("{vault_key}.bin"))
    }

    // ---- identity / device -------------------------------------------------

    /// Insert or replace the user identity.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn put_identity(&self, identity: &Identity) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO identity
             (id, pq_public_key, pq_private_key_encrypted, recovery_phrase_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                identity.id.to_string(),
                identity.pq_public_key,
                identity.pq_private_key_encrypted,
                identity.recovery_phrase_hash,
                now_unix(),
            ],
        )?;
        Ok(())
    }

    /// Fetch an identity by id.
    ///
    /// # Errors
    /// Returns an error if the database read fails or a stored id is malformed.
    pub fn get_identity(&self, id: Uuid) -> Result<Option<Identity>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, pq_public_key, pq_private_key_encrypted, recovery_phrase_hash
             FROM identity WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id.to_string()])?;
        match rows.next()? {
            Some(row) => {
                let id: String = row.get(0)?;
                Ok(Some(Identity {
                    id: parse_uuid(&id)?,
                    pq_public_key: row.get(1)?,
                    pq_private_key_encrypted: row.get(2)?,
                    recovery_phrase_hash: row.get(3)?,
                }))
            }
            None => Ok(None),
        }
    }

    /// Pair a device to an identity.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn add_device(&self, device: &Device) -> Result<()> {
        self.conn.execute(
            "INSERT INTO device (id, identity_id, platform, paired_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                device.id.to_string(),
                device.identity_id.to_string(),
                device.platform,
                now_unix(),
            ],
        )?;
        Ok(())
    }

    // ---- bundles -----------------------------------------------------------

    /// Create a bundle, returning its id.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn create_bundle(&self, title: &str, manifest: &[u8]) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.conn.execute(
            "INSERT INTO bundle (id, title, manifest, sealed, updated_at) VALUES (?1, ?2, ?3, 0, ?4)",
            params![id.to_string(), title, manifest, now_unix()],
        )?;
        Ok(id)
    }

    /// Fetch a bundle by id.
    ///
    /// # Errors
    /// Returns an error if the database read fails or a stored id is malformed.
    pub fn get_bundle(&self, id: Uuid) -> Result<Option<BundleRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, title, manifest, sealed, updated_at FROM bundle WHERE id = ?1")?;
        let mut rows = stmt.query(params![id.to_string()])?;
        match rows.next()? {
            Some(row) => Ok(Some(bundle_from_row(row)?)),
            None => Ok(None),
        }
    }

    /// List all bundles, most recently updated first.
    ///
    /// # Errors
    /// Returns an error if the database read fails.
    pub fn list_bundles(&self) -> Result<Vec<BundleRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, manifest, sealed, updated_at FROM bundle ORDER BY updated_at DESC",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(bundle_from_row(row)?);
        }
        Ok(out)
    }

    /// Set a bundle's sealed flag.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn set_sealed(&self, id: Uuid, sealed: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE bundle SET sealed = ?2, updated_at = ?3 WHERE id = ?1",
            params![id.to_string(), i64::from(sealed), now_unix()],
        )?;
        Ok(())
    }

    // ---- documents (encrypted vault) ---------------------------------------

    /// Store a document's content in the encrypted vault and record its
    /// metadata, returning the new document id.
    ///
    /// The plaintext is encrypted before it touches disk; only ciphertext is
    /// written, and only a vault reference is stored in the database.
    ///
    /// # Errors
    /// Returns an error if encryption, the vault write, or the database write
    /// fails.
    pub fn put_document(
        &self,
        bundle_id: Uuid,
        doc_type: DocType,
        title: &str,
        content: &[u8],
    ) -> Result<Uuid> {
        let id = Uuid::new_v4();
        let vault_key = Uuid::new_v4().to_string();
        let blob = self.cipher.encrypt(content)?;
        fs::write(self.vault_path(&vault_key), &blob)?;
        // New documents go to the end of the bundle's order (Portfolio).
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM document WHERE bundle_id = ?1",
            params![bundle_id.to_string()],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO document (id, bundle_id, doc_type, vault_key, title, position, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id.to_string(),
                bundle_id.to_string(),
                doc_type.as_str(),
                vault_key,
                title,
                position,
                now_unix(),
            ],
        )?;
        Ok(id)
    }

    /// Read and decrypt a document's content from the vault.
    ///
    /// # Errors
    /// Returns [`Error::NotFound`] if the document is unknown, or a crypto/I/O
    /// error if the vault file is missing or cannot be decrypted.
    pub fn read_document(&self, document_id: Uuid) -> Result<Vec<u8>> {
        let vault_key: String = self
            .conn
            .query_row(
                "SELECT vault_key FROM document WHERE id = ?1",
                params![document_id.to_string()],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    Error::NotFound(format!("document {document_id}"))
                }
                other => Error::Sqlite(other),
            })?;
        let blob = fs::read(self.vault_path(&vault_key))?;
        self.cipher.decrypt(&blob)
    }

    /// List the documents in a bundle, in their Portfolio order.
    ///
    /// # Errors
    /// Returns an error if the database read fails or a stored value is invalid.
    pub fn list_documents(&self, bundle_id: Uuid) -> Result<Vec<DocumentRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, bundle_id, doc_type, title, updated_at FROM document
             WHERE bundle_id = ?1 ORDER BY position ASC, rowid ASC",
        )?;
        let mut rows = stmt.query(params![bundle_id.to_string()])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let bundle_id: String = row.get(1)?;
            let doc_type: String = row.get(2)?;
            out.push(DocumentRow {
                id: parse_uuid(&id)?,
                bundle_id: parse_uuid(&bundle_id)?,
                doc_type: DocType::from_db_str(&doc_type)
                    .ok_or_else(|| Error::Invalid(format!("doc_type {doc_type}")))?,
                title: row.get(3)?,
                updated_at: row.get(4)?,
            });
        }
        Ok(out)
    }

    /// Reorder a bundle's documents to match `ordered` (the Portfolio drag-
    /// reorder). Any documents not named are kept, appended after the named ones
    /// in their existing relative order (defensive, mirrors the dev mock).
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn reorder_documents(&self, bundle_id: Uuid, ordered: &[Uuid]) -> Result<()> {
        let named: std::collections::HashSet<Uuid> = ordered.iter().copied().collect();
        // Capture the current order before mutating, so unnamed docs keep theirs.
        let existing = self.list_documents(bundle_id)?;
        let mut position: i64 = 0;
        for id in ordered {
            self.conn.execute(
                "UPDATE document SET position = ?2 WHERE id = ?1 AND bundle_id = ?3",
                params![id.to_string(), position, bundle_id.to_string()],
            )?;
            position += 1;
        }
        for doc in existing {
            if !named.contains(&doc.id) {
                self.conn.execute(
                    "UPDATE document SET position = ?2 WHERE id = ?1",
                    params![doc.id.to_string(), position],
                )?;
                position += 1;
            }
        }
        Ok(())
    }

    // ---- versions ----------------------------------------------------------

    /// Append a version (CRDT snapshot) for a document, returning its id.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn add_version(&self, document_id: Uuid, crdt_state: &[u8]) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.conn.execute(
            "INSERT INTO version (id, document_id, crdt_state, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                id.to_string(),
                document_id.to_string(),
                crdt_state,
                now_unix()
            ],
        )?;
        Ok(id)
    }

    /// Count the versions recorded for a document.
    ///
    /// # Errors
    /// Returns an error if the database read fails.
    pub fn version_count(&self, document_id: Uuid) -> Result<usize> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM version WHERE document_id = ?1",
            params![document_id.to_string()],
            |row| row.get(0),
        )?;
        Ok(usize::try_from(count).unwrap_or(0))
    }

    // ---- preferences -------------------------------------------------------

    /// Insert or replace a preference value (UTF-8), encrypted with the vault
    /// cipher. Keys are opaque client-owned strings.
    ///
    /// # Errors
    /// Returns a crypto error if encryption fails, or a database error on write.
    pub fn set_preference(&self, key: &str, value: &str) -> Result<()> {
        let blob = self.cipher.encrypt(value.as_bytes())?;
        self.conn.execute(
            "INSERT INTO preference (key, value_enc, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_enc = ?2, updated_at = ?3",
            params![key, blob, now_unix()],
        )?;
        Ok(())
    }

    /// Read and decrypt a preference value, or `None` if the key is unset.
    ///
    /// # Errors
    /// Returns a crypto error if decryption fails, an error if the stored bytes
    /// are not valid UTF-8, or a database error on read.
    pub fn get_preference(&self, key: &str) -> Result<Option<String>> {
        let blob: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT value_enc FROM preference WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        match blob {
            Some(blob) => {
                let bytes = self.cipher.decrypt(&blob)?;
                let text = String::from_utf8(bytes)
                    .map_err(|_| Error::Invalid(format!("preference {key} is not UTF-8")))?;
                Ok(Some(text))
            }
            None => Ok(None),
        }
    }

    /// List every stored preference as `(key, value)`, decrypted. Used by the
    /// client to hydrate its in-memory preference cache at startup.
    ///
    /// # Errors
    /// Returns a crypto error if a value cannot be decrypted, an error if a
    /// value is not valid UTF-8, or a database error on read.
    pub fn list_preferences(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value_enc FROM preference ORDER BY key")?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let key: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            let bytes = self.cipher.decrypt(&blob)?;
            let value = String::from_utf8(bytes)
                .map_err(|_| Error::Invalid(format!("preference {key} is not UTF-8")))?;
            out.push((key, value));
        }
        Ok(out)
    }

    // ---- records -----------------------------------------------------------

    /// Create a Records table in a bundle, returning its id.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn create_table(&self, bundle_id: Uuid, name: &str) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.conn.execute(
            "INSERT INTO record_table (id, bundle_id, name) VALUES (?1, ?2, ?3)",
            params![id.to_string(), bundle_id.to_string(), name],
        )?;
        Ok(id)
    }

    /// Add a field/column to a Records table, returning its id.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn add_field(&self, table_id: Uuid, name: &str, datatype: &str) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.conn.execute(
            "INSERT INTO record_field (id, table_id, name, datatype) VALUES (?1, ?2, ?3, ?4)",
            params![id.to_string(), table_id.to_string(), name, datatype],
        )?;
        Ok(id)
    }

    /// Insert a row into a Records table, returning its id.
    ///
    /// # Errors
    /// Returns an error if the values cannot be serialized or the write fails.
    pub fn insert_row(&self, table_id: Uuid, values: &RowValues) -> Result<Uuid> {
        let id = Uuid::new_v4();
        let json = serialize_values(values)?;
        self.conn.execute(
            "INSERT INTO record_row (id, table_id, values_json) VALUES (?1, ?2, ?3)",
            params![id.to_string(), table_id.to_string(), json],
        )?;
        Ok(id)
    }

    /// Update an existing Records row's values in place, so edits to saved rows
    /// persist (seam #2). A no-op if the row id is unknown, matching the dev
    /// mock's lenient contract.
    ///
    /// # Errors
    /// Returns an error if the values cannot be serialized or the write fails.
    pub fn update_row(&self, row_id: Uuid, values: &RowValues) -> Result<()> {
        let json = serialize_values(values)?;
        self.conn.execute(
            "UPDATE record_row SET values_json = ?2 WHERE id = ?1",
            params![row_id.to_string(), json],
        )?;
        Ok(())
    }

    /// Delete a Records row by id (seam #2). A no-op if the id is unknown.
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn delete_row(&self, row_id: Uuid) -> Result<()> {
        self.conn.execute(
            "DELETE FROM record_row WHERE id = ?1",
            params![row_id.to_string()],
        )?;
        Ok(())
    }

    /// List the tables in a bundle.
    ///
    /// # Errors
    /// Returns an error if the database read fails or a stored id is malformed.
    pub fn list_tables(&self, bundle_id: Uuid) -> Result<Vec<RecordTable>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, bundle_id, name FROM record_table WHERE bundle_id = ?1")?;
        let mut rows = stmt.query(params![bundle_id.to_string()])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let bundle_id: String = row.get(1)?;
            out.push(RecordTable {
                id: parse_uuid(&id)?,
                bundle_id: parse_uuid(&bundle_id)?,
                name: row.get(2)?,
            });
        }
        Ok(out)
    }

    /// List the fields of a Records table.
    ///
    /// # Errors
    /// Returns an error if the database read fails or a stored id is malformed.
    pub fn list_fields(&self, table_id: Uuid) -> Result<Vec<RecordField>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, table_id, name, datatype FROM record_field WHERE table_id = ?1")?;
        let mut rows = stmt.query(params![table_id.to_string()])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let table_id: String = row.get(1)?;
            out.push(RecordField {
                id: parse_uuid(&id)?,
                table_id: parse_uuid(&table_id)?,
                name: row.get(2)?,
                datatype: row.get(3)?,
            });
        }
        Ok(out)
    }

    /// List the rows of a Records table.
    ///
    /// # Errors
    /// Returns an error if the database read fails or a stored value is invalid.
    pub fn list_rows(&self, table_id: Uuid) -> Result<Vec<RecordRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, table_id, values_json FROM record_row WHERE table_id = ?1")?;
        let mut rows = stmt.query(params![table_id.to_string()])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let table_id: String = row.get(1)?;
            let json: String = row.get(2)?;
            out.push(RecordRow {
                id: parse_uuid(&id)?,
                table_id: parse_uuid(&table_id)?,
                values: deserialize_values(&json)?,
            });
        }
        Ok(out)
    }

    // ---- seal grants -------------------------------------------------------

    /// Record a seal grant (a wrapped content key for a recipient identity).
    ///
    /// # Errors
    /// Returns an error if the database write fails.
    pub fn add_seal_grant(
        &self,
        bundle_id: Uuid,
        identity_id: Uuid,
        wrapped_content_key: &[u8],
    ) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.conn.execute(
            "INSERT INTO seal_grant (id, bundle_id, identity_id, wrapped_content_key)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                id.to_string(),
                bundle_id.to_string(),
                identity_id.to_string(),
                wrapped_content_key,
            ],
        )?;
        Ok(id)
    }

    // ---- backup / export ---------------------------------------------------

    /// Export a portable backup archive (metadata database + encrypted vault).
    ///
    /// The archive is restorable on a clean install with the same identity
    /// (`AC-STO-4`). Vault content remains encrypted inside the archive.
    ///
    /// # Errors
    /// Returns an error if the database or vault cannot be read or the archive
    /// cannot be written.
    pub fn export_backup(&self, out_path: &Path) -> Result<()> {
        // Ensure committed data is in the main database file.
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .ok();

        let file = fs::File::create(out_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let db_bytes = fs::read(self.root.join(DB_FILE))?;
        zip.start_file(DB_FILE, opts)?;
        zip.write_all(&db_bytes)?;

        for entry in fs::read_dir(self.root.join(VAULT_DIR))? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let bytes = fs::read(entry.path())?;
                zip.start_file(format!("{VAULT_DIR}/{name}"), opts)?;
                zip.write_all(&bytes)?;
            }
        }
        zip.finish()?;
        Ok(())
    }

    /// Restore a backup archive into a fresh `dest_root` and open the store.
    ///
    /// # Errors
    /// Returns an error if the archive is malformed or extraction fails.
    pub fn restore_backup(
        backup_path: &Path,
        dest_root: &Path,
        identity_secret: &[u8],
    ) -> Result<Self> {
        fs::create_dir_all(dest_root)?;
        fs::create_dir_all(dest_root.join(VAULT_DIR))?;

        let file = fs::File::open(backup_path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            if !entry.is_file() {
                continue;
            }
            let name = entry.name()?.into_owned();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            let dest = if name == DB_FILE {
                dest_root.join(DB_FILE)
            } else if let Some(vault_name) = name.strip_prefix(&format!("{VAULT_DIR}/")) {
                dest_root.join(VAULT_DIR).join(vault_name)
            } else {
                continue;
            };
            fs::write(dest, bytes)?;
        }

        Self::open(dest_root, identity_secret)
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

fn parse_uuid(s: &str) -> Result<Uuid> {
    Uuid::parse_str(s).map_err(|e| Error::Invalid(format!("malformed uuid {s:?}: {e}")))
}

fn bundle_from_row(row: &rusqlite::Row<'_>) -> Result<BundleRow> {
    let id: String = row.get(0)?;
    let sealed: i64 = row.get(3)?;
    Ok(BundleRow {
        id: parse_uuid(&id)?,
        title: row.get(1)?,
        manifest: row.get(2)?,
        sealed: sealed != 0,
        updated_at: row.get(4)?,
    })
}

fn serialize_values(values: &RowValues) -> Result<String> {
    let map: BTreeMap<String, &RecordValue> =
        values.iter().map(|(k, v)| (k.to_string(), v)).collect();
    Ok(serde_json::to_string(&map)?)
}

fn deserialize_values(json: &str) -> Result<RowValues> {
    let map: BTreeMap<String, RecordValue> = serde_json::from_str(json)?;
    map.into_iter()
        .map(|(k, v)| Ok((parse_uuid(&k)?, v)))
        .collect()
}
