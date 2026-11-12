//! Database schema and migrations.
//!
//! Migrations are an ordered list of SQL scripts. The applied version is tracked
//! in `schema_version`; [`apply_migrations`] runs any not-yet-applied scripts,
//! so opening an existing store upgrades it in place (zero-config, `AC-STO-1`).

use rusqlite::Connection;

use crate::error::Result;

/// Ordered migration scripts. Append new scripts; never edit applied ones.
const MIGRATIONS: &[&str] = &[
    // v1, initial schema mirroring diagram 05_er.
    "
    CREATE TABLE identity (
        id                        TEXT PRIMARY KEY,
        pq_public_key             BLOB NOT NULL,
        pq_private_key_encrypted  BLOB NOT NULL,
        recovery_phrase_hash      TEXT NOT NULL,
        created_at                INTEGER NOT NULL
    );

    CREATE TABLE device (
        id           TEXT PRIMARY KEY,
        identity_id  TEXT NOT NULL REFERENCES identity(id) ON DELETE CASCADE,
        platform     TEXT NOT NULL,
        paired_at    INTEGER NOT NULL
    );

    CREATE TABLE bundle (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        manifest    BLOB NOT NULL,
        sealed      INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL
    );

    -- Document content is NOT stored here; only a reference to the encrypted
    -- vault file. This keeps plaintext content out of the metadata DB (AC-DATA-1).
    CREATE TABLE document (
        id          TEXT PRIMARY KEY,
        bundle_id   TEXT NOT NULL REFERENCES bundle(id) ON DELETE CASCADE,
        doc_type    TEXT NOT NULL,
        vault_key   TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
    );

    CREATE TABLE version (
        id           TEXT PRIMARY KEY,
        document_id  TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
        crdt_state   BLOB NOT NULL,
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE record_table (
        id         TEXT PRIMARY KEY,
        bundle_id  TEXT NOT NULL REFERENCES bundle(id) ON DELETE CASCADE,
        name       TEXT NOT NULL
    );

    CREATE TABLE record_field (
        id        TEXT PRIMARY KEY,
        table_id  TEXT NOT NULL REFERENCES record_table(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        datatype  TEXT NOT NULL
    );

    CREATE TABLE record_row (
        id        TEXT PRIMARY KEY,
        table_id  TEXT NOT NULL REFERENCES record_table(id) ON DELETE CASCADE,
        values_json  TEXT NOT NULL
    );

    CREATE TABLE seal_grant (
        id                   TEXT PRIMARY KEY,
        bundle_id            TEXT NOT NULL REFERENCES bundle(id) ON DELETE CASCADE,
        identity_id          TEXT NOT NULL REFERENCES identity(id) ON DELETE CASCADE,
        wrapped_content_key  BLOB NOT NULL
    );

    CREATE INDEX idx_document_bundle ON document(bundle_id);
    CREATE INDEX idx_record_table_bundle ON record_table(bundle_id);
    CREATE INDEX idx_record_field_table ON record_field(table_id);
    CREATE INDEX idx_record_row_table ON record_row(table_id);
    ",
    // v2: a small encrypted key/value table for user preferences (theme, Ember
    // effort, Sheets style sets, ...). The value is stored encrypted with the
    // same vault cipher as document content, so preferences travel with sync and
    // never sit in the metadata DB as plaintext (AC-DATA-1). Keys are opaque
    // strings owned by the client (e.g. `hb-theme`, `hb-styles:<bundle>`).
    "
    CREATE TABLE preference (
        key         TEXT PRIMARY KEY,
        value_enc   BLOB NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    ",
    // v3: documents gain a human title and an explicit ordering position, so the
    // Bundle "contents" list shows real titles and the Portfolio drag-reorder
    // persists (seam #1: the `list_documents` / `reorder_documents` contract the
    // client and the dev mock already rely on). Existing rows default to an empty
    // title and position 0; new rows are titled and positioned on insert.
    "
    ALTER TABLE document ADD COLUMN title TEXT NOT NULL DEFAULT '';
    ALTER TABLE document ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    ",
];

/// Apply any migrations newer than the database's current schema version.
///
/// # Errors
/// Returns an error if a migration script fails to execute.
pub(crate) fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    let target = i64::try_from(MIGRATIONS.len()).unwrap_or(i64::MAX);
    for version in current..target {
        let idx = usize::try_from(version).unwrap_or(0);
        conn.execute_batch(MIGRATIONS[idx])?;
        conn.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [version + 1],
        )?;
    }
    Ok(())
}
