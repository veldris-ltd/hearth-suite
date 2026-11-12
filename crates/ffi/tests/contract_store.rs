//! Seam #1 contract suite: the real `HearthCore` must honour the exact backend
//! contract the UI relies on (the same behaviour `apps/desktop/tests/
//! mock-store.test.mjs` asserts against the dev `MockStore`).
//!
//! Covers every method the dev mock implements but the core previously lacked,
//! plus `list_bundles.updated_at`: `list_fields`, `update_row`, `delete_row`,
//! `list_documents` (title + order), and `reorder_documents`.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use hearth_ember_bridge::testing::MockBackend;
use hearth_ember_bridge::InferenceBackend;
use hearth_ffi::dto::{
    CreateBundleRequest, DocTypeDto, FieldValue, InsertRowRequest, RecordValueDto,
    SaveDocumentRequest, UpdateRowRequest,
};
use hearth_ffi::HearthCore;

fn open() -> (HearthCore, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("temp dir");
    let backend: Box<dyn InferenceBackend> = Box::new(MockBackend::canned("x"));
    let core = HearthCore::open(dir.path(), &[9u8; 32], backend).expect("open core");
    (core, dir)
}

fn bundle(core: &HearthCore, title: &str) -> String {
    core.create_bundle(&CreateBundleRequest {
        title: title.to_owned(),
    })
    .expect("create bundle")
    .id
}

fn text(value: &str) -> RecordValueDto {
    RecordValueDto::Text(value.to_owned())
}

/// `table → fields → rows` lifecycle: `list_fields` echoes what was added, with
/// ids and types; insert + query round-trips (seam #3).
#[test]
fn table_fields_rows_lifecycle() {
    let (core, _dir) = open();
    let b = bundle(&core, "People bundle");
    let table = core.create_table(&b, "People").unwrap();
    let f_name = core.add_field(&table, "Name", "text").unwrap();
    let f_age = core.add_field(&table, "Age", "number").unwrap();

    let fields = core.list_fields(&table).unwrap();
    assert_eq!(fields.len(), 2);
    assert_eq!(
        (&fields[0].name, &fields[0].datatype),
        (&"Name".to_owned(), &"text".to_owned())
    );
    assert_eq!(
        (&fields[1].name, &fields[1].datatype),
        (&"Age".to_owned(), &"number".to_owned())
    );
    assert_eq!(fields[0].id, f_name);
    assert_eq!(fields[1].id, f_age);

    let r1 = core
        .insert_row(&InsertRowRequest {
            table_id: table.clone(),
            values: vec![FieldValue {
                field_id: f_name.clone(),
                value: text("Ada"),
            }],
        })
        .unwrap();
    core.insert_row(&InsertRowRequest {
        table_id: table.clone(),
        values: vec![FieldValue {
            field_id: f_name,
            value: text("Linus"),
        }],
    })
    .unwrap();

    let rows = core.query_rows(&table).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|r| r.id == r1));
}

/// `update_row` reflects on the next query (no silent loss, seam #2).
#[test]
fn update_row_reflects_on_query() {
    let (core, _dir) = open();
    let b = bundle(&core, "b");
    let table = core.create_table(&b, "T").unwrap();
    let f = core.add_field(&table, "Name", "text").unwrap();
    let row_id = core
        .insert_row(&InsertRowRequest {
            table_id: table.clone(),
            values: vec![FieldValue {
                field_id: f.clone(),
                value: text("Ada"),
            }],
        })
        .unwrap();

    let returned = core
        .update_row(&UpdateRowRequest {
            row_id: row_id.clone(),
            values: vec![FieldValue {
                field_id: f,
                value: text("Ada Lovelace"),
            }],
        })
        .unwrap();
    assert_eq!(returned, row_id);

    let rows = core.query_rows(&table).unwrap();
    assert_eq!(rows.len(), 1);
    match &rows[0].values[0].value {
        RecordValueDto::Text(t) => assert_eq!(t, "Ada Lovelace"),
        other => panic!("expected updated text, got {other:?}"),
    }
}

/// `delete_row` removes the row (seam #2).
#[test]
fn delete_row_removes_the_row() {
    let (core, _dir) = open();
    let b = bundle(&core, "b");
    let table = core.create_table(&b, "T").unwrap();
    let f = core.add_field(&table, "Name", "text").unwrap();
    let a = core
        .insert_row(&InsertRowRequest {
            table_id: table.clone(),
            values: vec![FieldValue {
                field_id: f.clone(),
                value: text("A"),
            }],
        })
        .unwrap();
    core.insert_row(&InsertRowRequest {
        table_id: table.clone(),
        values: vec![FieldValue {
            field_id: f,
            value: text("B"),
        }],
    })
    .unwrap();

    core.delete_row(&a).unwrap();
    let rows = core.query_rows(&table).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows.iter().all(|r| r.id != a));
}

/// `list_tables` scopes to a bundle.
#[test]
fn list_tables_scopes_to_bundle() {
    let (core, _dir) = open();
    let b1 = bundle(&core, "one");
    let b2 = bundle(&core, "two");
    core.create_table(&b1, "One").unwrap();
    core.create_table(&b1, "Two").unwrap();
    core.create_table(&b2, "Other").unwrap();

    let names: Vec<String> = core
        .list_tables(&b1)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(names, ["One", "Two"]);
    assert_eq!(core.list_tables(&b2).unwrap().len(), 1);
}

/// Documents save and list per bundle, carry a title and content, and reorder
/// persists (seam #1 — the Portfolio contract).
#[test]
fn documents_title_content_and_reorder() {
    let (core, _dir) = open();
    let b = bundle(&core, "Portfolio");
    let save = |doc_type, title: &str, body: &[u8]| {
        core.save_document(&SaveDocumentRequest {
            bundle_id: b.clone(),
            doc_type,
            content_base64: B64.encode(body),
            title: Some(title.to_owned()),
        })
        .unwrap()
    };
    let a = save(DocTypeDto::Writer, "Cover letter", b"ABC");
    let bdoc = save(DocTypeDto::Sheet, "Budget", b"DEF");
    let c = save(DocTypeDto::Record, "People", b"");

    let titles: Vec<String> = core
        .list_documents(&b)
        .unwrap()
        .into_iter()
        .map(|d| d.title)
        .collect();
    assert_eq!(titles, ["Cover letter", "Budget", "People"]);

    // Content round-trips through the encrypted vault.
    assert_eq!(
        B64.decode(core.open_document(&a.id).unwrap().content_base64)
            .unwrap(),
        b"ABC"
    );
    assert_eq!(
        B64.decode(core.open_document(&bdoc.id).unwrap().content_base64)
            .unwrap(),
        b"DEF"
    );

    // Drag-reorder: People, Cover letter, Budget.
    core.reorder_documents(&b, &[c.id.clone(), a.id.clone(), bdoc.id.clone()])
        .unwrap();
    let reordered: Vec<String> = core
        .list_documents(&b)
        .unwrap()
        .into_iter()
        .map(|d| d.title)
        .collect();
    assert_eq!(reordered, ["People", "Cover letter", "Budget"]);

    // The bundle's document_count reflects the saved documents.
    let listed = core.list_bundles().unwrap();
    let summary = listed.iter().find(|s| s.id == b).expect("bundle present");
    assert_eq!(summary.document_count, 3);
}

/// `list_bundles` populates `updated_at` as an RFC 3339 / ISO 8601 UTC string,
/// most-recently-updated first — the specific seam #1 acceptance bit (AC-WKS-S3).
#[test]
fn list_bundles_populates_updated_at() {
    let (core, _dir) = open();
    let created = bundle(&core, "Dated");
    let summary = core
        .create_bundle(&CreateBundleRequest {
            title: "Another".to_owned(),
        })
        .unwrap();
    assert!(
        summary.updated_at.is_some(),
        "create_bundle surfaces updated_at"
    );

    let bundles = core.list_bundles().unwrap();
    let dated = bundles
        .iter()
        .find(|s| s.id == created)
        .expect("bundle present");
    let stamp = dated.updated_at.as_deref().expect("updated_at populated");
    // Shape: YYYY-MM-DDTHH:MM:SSZ.
    assert_eq!(stamp.len(), 20, "RFC3339 length, got {stamp:?}");
    assert!(
        stamp.ends_with('Z') && stamp.as_bytes()[10] == b'T',
        "ISO 8601 shape, got {stamp:?}"
    );
    assert!(stamp.starts_with("20"), "a plausible year, got {stamp:?}");
}
