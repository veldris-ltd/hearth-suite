//! Store integration tests (`AC-STO-1..4`, `AC-DATA-1`).

use std::path::Path;

use hearth_store::error::Error;
use hearth_store::models::{DocType, RecordValue, RowValues};
use hearth_store::Store;
use uuid::Uuid;

const SECRET: &[u8] = b"test-identity-secret-material-0001";

fn read_only_vault_file(root: &Path) -> Vec<u8> {
    let dir = root.join("vault");
    let entry = std::fs::read_dir(&dir)
        .expect("vault dir")
        .filter_map(std::result::Result::ok)
        .find(|e| e.path().extension().is_some_and(|x| x == "bin"))
        .expect("a vault file");
    std::fs::read(entry.path()).expect("read vault file")
}

/// AC-STO-1: create/save/read works fully offline with zero configuration.
#[test]
fn offline_zero_config_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path(), SECRET).expect("open");

    let bundle = store.create_bundle("My Project", b"{}").expect("bundle");
    let content = b"Hello from a fully offline Hearth Suite.".to_vec();
    let doc = store
        .put_document(bundle, DocType::Writer, "Letter", &content)
        .expect("put");

    assert_eq!(store.read_document(doc).expect("read"), content);
    assert_eq!(store.list_documents(bundle).expect("list").len(), 1);
}

/// AC-STO-2: content is encrypted at rest and unreadable without the identity.
#[test]
fn encryption_at_rest() {
    let dir = tempfile::tempdir().unwrap();
    let plaintext = b"TOP-SECRET quarterly figures: 4815162342".to_vec();

    let bundle;
    let doc;
    {
        let store = Store::open(dir.path(), SECRET).expect("open");
        bundle = store.create_bundle("Secret", b"{}").unwrap();
        doc = store
            .put_document(bundle, DocType::Writer, "Letter", &plaintext)
            .unwrap();
    }

    // The raw vault file must not contain the plaintext.
    let raw = read_only_vault_file(dir.path());
    assert!(
        !contains_subslice(&raw, &plaintext),
        "plaintext leaked into the vault file"
    );

    // Reopening with the wrong identity secret fails to decrypt.
    let wrong = Store::open(dir.path(), b"the-wrong-secret").expect("open");
    assert!(matches!(wrong.read_document(doc), Err(Error::Crypto(_))));

    // Reopening with the correct secret recovers the content.
    let right = Store::open(dir.path(), SECRET).expect("open");
    assert_eq!(right.read_document(doc).unwrap(), plaintext);
    let _ = bundle;
}

/// AC-DATA-1: the metadata database contains no plaintext document content.
#[test]
fn no_plaintext_content_in_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let marker = b"UNIQUE-PLAINTEXT-MARKER-9F3A-DOCBODY".to_vec();

    {
        let store = Store::open(dir.path(), SECRET).unwrap();
        let bundle = store.create_bundle("Doc", b"{}").unwrap();
        store
            .put_document(bundle, DocType::Writer, "Letter", &marker)
            .unwrap();
    }

    let db_bytes = std::fs::read(dir.path().join("hearth.db")).expect("read db");
    assert!(
        !contains_subslice(&db_bytes, &marker),
        "document content leaked into the metadata database"
    );
}

/// AC-STO-3: Records tables/fields/rows persist per the ER model and survive
/// restart.
#[test]
fn records_model_persists_across_restart() {
    let dir = tempfile::tempdir().unwrap();

    let (bundle, table, name_field, age_field) = {
        let store = Store::open(dir.path(), SECRET).unwrap();
        let bundle = store.create_bundle("Contacts", b"{}").unwrap();
        let table = store.create_table(bundle, "People").unwrap();
        let name_field = store.add_field(table, "name", "text").unwrap();
        let age_field = store.add_field(table, "age", "integer").unwrap();

        let mut row: RowValues = RowValues::new();
        row.insert(name_field, RecordValue::Text("Ada".to_owned()));
        row.insert(age_field, RecordValue::Integer(36));
        store.insert_row(table, &row).unwrap();
        (bundle, table, name_field, age_field)
    };

    // Reopen (simulating a restart) and verify everything persisted.
    let store = Store::open(dir.path(), SECRET).unwrap();
    assert_eq!(store.list_tables(bundle).unwrap().len(), 1);
    assert_eq!(store.list_fields(table).unwrap().len(), 2);

    let rows = store.list_rows(table).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].values.get(&name_field),
        Some(&RecordValue::Text("Ada".to_owned()))
    );
    assert_eq!(
        rows[0].values.get(&age_field),
        Some(&RecordValue::Integer(36))
    );
}

/// P2-CL3: preferences persist (encrypted) across restart, upsert by key, and
/// list back for cache hydration. This is the vault-backed home for theme,
/// Ember effort, and Sheets style sets, so they travel with sync.
#[test]
fn preferences_persist_encrypted_across_restart() {
    let dir = tempfile::tempdir().unwrap();
    let secret_value = "[{\"id\":\"my-house-style\",\"name\":\"House style\"}]";

    {
        let store = Store::open(dir.path(), SECRET).unwrap();
        assert_eq!(store.get_preference("hb-theme").unwrap(), None);
        store.set_preference("hb-theme", "dark").unwrap();
        store.set_preference("hb-effort", "fast").unwrap();
        store
            .set_preference("hb-styles:bundle-1", secret_value)
            .unwrap();
        // Upsert replaces in place rather than appending.
        store.set_preference("hb-theme", "light").unwrap();
    }

    // The encrypted value must not sit in the metadata DB as plaintext.
    let db_bytes = std::fs::read(dir.path().join("hearth.db")).expect("read db");
    assert!(
        !contains_subslice(&db_bytes, secret_value.as_bytes()),
        "preference value leaked into the metadata database"
    );

    // Reopen (restart) and confirm the values survived and upsert won.
    let store = Store::open(dir.path(), SECRET).unwrap();
    assert_eq!(
        store.get_preference("hb-theme").unwrap().as_deref(),
        Some("light")
    );
    assert_eq!(
        store.get_preference("hb-effort").unwrap().as_deref(),
        Some("fast")
    );
    let listed = store.list_preferences().unwrap();
    assert_eq!(listed.len(), 3);
    assert!(listed
        .iter()
        .any(|(k, v)| k == "hb-styles:bundle-1" && v == secret_value));

    // The wrong identity cannot decrypt the preference.
    let wrong = Store::open(dir.path(), b"the-wrong-secret").expect("open");
    assert!(matches!(
        wrong.get_preference("hb-theme"),
        Err(Error::Crypto(_))
    ));
}

/// AC-STO-4: a backup is portable and restorable on a clean install.
#[test]
fn backup_and_restore() {
    let src = tempfile::tempdir().unwrap();
    let backup = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let backup_path = backup.path().join("hearth-backup.zip");

    let content = b"Backup me precisely, byte for byte.".to_vec();
    let (bundle, doc, table, field) = {
        let store = Store::open(src.path(), SECRET).unwrap();
        let bundle = store.create_bundle("Project", b"{}").unwrap();
        let doc = store
            .put_document(bundle, DocType::Sheet, "Budget", &content)
            .unwrap();
        let table = store.create_table(bundle, "Sheet1").unwrap();
        let field = store.add_field(table, "col", "text").unwrap();
        let mut row = RowValues::new();
        row.insert(field, RecordValue::Text("cell".to_owned()));
        store.insert_row(table, &row).unwrap();
        store.export_backup(&backup_path).expect("export");
        (bundle, doc, table, field)
    };

    // Restore on a "clean install" with the same identity.
    let restored = Store::restore_backup(&backup_path, dest.path(), SECRET).expect("restore");

    assert_eq!(restored.read_document(doc).unwrap(), content);
    assert_eq!(restored.list_bundles().unwrap().len(), 1);
    let rows = restored.list_rows(table).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].values.get(&field),
        Some(&RecordValue::Text("cell".to_owned()))
    );
    let _ = bundle;
}

/// ER completeness: versions and seal grants persist and are countable.
#[test]
fn versions_and_grants() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path(), SECRET).unwrap();

    let bundle = store.create_bundle("Versioned", b"{}").unwrap();
    let doc = store
        .put_document(bundle, DocType::Writer, "Letter", b"v1")
        .unwrap();
    store.add_version(doc, b"crdt-state-1").unwrap();
    store.add_version(doc, b"crdt-state-2").unwrap();
    assert_eq!(store.version_count(doc).unwrap(), 2);

    let identity = Uuid::new_v4();
    // A seal grant references a recipient identity; insert one for completeness.
    store
        .add_seal_grant(bundle, recipient(&store, identity), b"wrapped-key")
        .expect("grant");
}

/// Insert a minimal identity so a seal-grant foreign key resolves.
fn recipient(store: &Store, id: Uuid) -> Uuid {
    use hearth_store::models::Identity;
    store
        .put_identity(&Identity {
            id,
            pq_public_key: vec![1, 2, 3],
            pq_private_key_encrypted: vec![4, 5, 6],
            recovery_phrase_hash: "hash".to_owned(),
        })
        .expect("identity");
    id
}

/// Whether `haystack` contains `needle` as a contiguous subslice.
fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty() || haystack.windows(needle.len()).any(|w| w == needle)
}
