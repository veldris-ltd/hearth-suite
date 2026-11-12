//! Binding integration tests (`AC-FFI-1..2`).
//!
//! Exercises the full facade surface natively, and round-trips a couple of calls
//! through the C-ABI. The WASM target is exercised in the web CI job via
//! `wasm-bindgen-test`; the bindings share the same `dispatch`, so this native
//! suite covers the surface.

// The C-ABI portion of these tests crosses the raw-pointer boundary.
#![allow(unsafe_code)]

use std::ffi::{CStr, CString};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use hearth_ember_bridge::testing::MockBackend;
use hearth_ember_bridge::InferenceBackend;
use hearth_ffi::dto::{
    CreateBundleRequest, DocTypeDto, EffortDto, EmberRequest, FieldValue, InsertRowRequest,
    RecordValueDto, SaveDocumentRequest, SealRequest, TaskDto,
};
use hearth_ffi::{
    call_json, hearth_call, hearth_core_free, hearth_core_into_raw, hearth_string_free, HearthCore,
};

fn open_core(seed: [u8; 32], reply: &str) -> (HearthCore, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let backend: Box<dyn InferenceBackend> = Box::new(MockBackend::canned(reply));
    let core = HearthCore::open(dir.path(), &seed, backend).expect("open core");
    (core, dir)
}

/// AC-FFI-2: the full binding surface works end-to-end.
#[test]
fn full_surface_round_trip() {
    let (mut core, _dir) = open_core([7u8; 32], "=SUM(A1:A10)\nExplanation: sums the range.");

    // open/save Bundle.
    let bundle = core
        .create_bundle(&CreateBundleRequest {
            title: "Project".to_owned(),
        })
        .unwrap();
    assert_eq!(core.list_bundles().unwrap().len(), 1);

    let doc = core
        .save_document(&SaveDocumentRequest {
            bundle_id: bundle.id.clone(),
            doc_type: DocTypeDto::Writer,
            content_base64: B64.encode(b"the document body"),
            title: None,
        })
        .unwrap();
    let opened = core.open_document(&doc.id).unwrap();
    assert_eq!(
        B64.decode(opened.content_base64).unwrap(),
        b"the document body"
    );

    // query Records.
    let table = core.create_table(&bundle.id, "People").unwrap();
    let field = core.add_field(&table, "name", "text").unwrap();
    core.insert_row(&InsertRowRequest {
        table_id: table.clone(),
        values: vec![FieldValue {
            field_id: field,
            value: RecordValueDto::Text("Ada".to_owned()),
        }],
    })
    .unwrap();
    assert_eq!(core.query_rows(&table).unwrap().len(), 1);

    // run Ember (device-local).
    let response = core
        .run_ember(&EmberRequest {
            task: TaskDto::Formula,
            document: String::new(),
            request: "sum of A1 to A10".to_owned(),
            effort: EffortDto::Balanced,
        })
        .unwrap();
    assert!(response.device_local);
    assert!(response.text.contains("=SUM(A1:A10)"));

    // on-device Ember tiers: mobile defaults to the smallest (Phi) tier.
    let tiers = core.ember_tiers();
    assert_eq!(tiers.len(), 2);
    let default_tier = tiers
        .iter()
        .find(|t| t.mobile_default)
        .expect("a mobile default");
    assert_eq!(default_tier.id, "phi3_mini");
    assert!(tiers
        .iter()
        .any(|t| t.id == "nemotron_nano" && !t.mobile_default));
    // Tiers are ordered smallest-first by RAM need.
    assert!(tiers[0].min_ram_mb <= tiers[1].min_ram_mb);

    // sync controls: off by default, toggleable.
    assert!(!core.sync_status().enabled);
    core.set_sync_enabled(true);
    assert!(core.sync_status().enabled);
}

/// AC-FFI-2: seal/unseal across two cores via the binding surface.
#[test]
fn seal_unseal_across_identities() {
    let (alice, _da) = open_core([1u8; 32], "x");
    let (bob, _db) = open_core([2u8; 32], "x");

    let sealed = alice
        .seal(&SealRequest {
            content_base64: B64.encode(b"top secret"),
            recipient_public_keys: vec![bob.identity_public()],
        })
        .unwrap();

    let opened = bob.unseal(&sealed).unwrap();
    assert_eq!(B64.decode(opened.content_base64).unwrap(), b"top secret");
    assert!(alice.verify(&sealed, &alice.identity_public()).unwrap());

    // `verify` is real, not a rubber stamp: it rejects a signature that wasn't
    // produced by the named signer (here, Bob's key over Alice's seal).
    assert!(
        !alice.verify(&sealed, &bob.identity_public()).unwrap(),
        "verify must reject a non-signer's key"
    );

    // Tampering with the ciphertext is detected (AEAD auth): unseal fails.
    let mut tampered = sealed.clone();
    let mut bytes = B64.decode(&tampered.content_base64).unwrap();
    bytes[0] ^= 0xff;
    tampered.content_base64 = B64.encode(&bytes);
    assert!(
        bob.unseal(&tampered).is_err(),
        "tampered content must not unseal"
    );
}

/// The in-process Rust transport (`call_json`) used by the Tauri desktop shell
/// dispatches the same surface as the C-ABI, returning the `ok`/`error` envelope.
#[test]
fn call_json_in_process_dispatch() {
    let (mut core, _dir) = open_core([6u8; 32], "x");

    let ok = call_json(
        &mut core,
        r#"{"method":"create_bundle","params":{"title":"viaTauri"}}"#,
    );
    assert!(ok.contains("\"ok\""), "got: {ok}");
    assert!(ok.contains("viaTauri"));

    let err = call_json(&mut core, r#"{"method":"no_such_method","params":{}}"#);
    assert!(err.contains("\"error\""), "got: {err}");
}

/// Seam #9: the `lexicon_dataset` method string is wired and returns the offline
/// dictionary the client hydrates from — a `{ word: record }` map carrying real
/// definitions (the embedded CC0 sample here; the full dataset in production).
#[test]
fn lexicon_dataset_via_dispatch() {
    let (mut core, _dir) = open_core([8u8; 32], "x");
    let response = call_json(&mut core, r#"{"method":"lexicon_dataset","params":{}}"#);
    assert!(response.contains("\"ok\""), "got: {response}");
    assert!(
        response.contains("\"calm\""),
        "dataset includes known words"
    );
    assert!(
        response.contains("peaceful"),
        "entries carry definitions/synonyms"
    );
}

/// AC-FFI-1/2: the native C-ABI transport dispatches the facade.
#[test]
fn c_abi_dispatch() {
    let (core, _dir) = open_core([5u8; 32], "x");
    let handle = hearth_core_into_raw(core);

    let request =
        CString::new(r#"{"method":"create_bundle","params":{"title":"viaCABI"}}"#).unwrap();
    let response_ptr = unsafe { hearth_call(handle, request.as_ptr()) };
    let response = unsafe { CStr::from_ptr(response_ptr) }
        .to_str()
        .unwrap()
        .to_owned();
    unsafe { hearth_string_free(response_ptr) };

    assert!(response.contains("\"ok\""), "got: {response}");
    assert!(response.contains("viaCABI"));

    let status_req = CString::new(r#"{"method":"sync_status","params":{}}"#).unwrap();
    let status_ptr = unsafe { hearth_call(handle, status_req.as_ptr()) };
    let status = unsafe { CStr::from_ptr(status_ptr) }
        .to_str()
        .unwrap()
        .to_owned();
    unsafe { hearth_string_free(status_ptr) };
    assert!(status.contains("\"enabled\":false"));

    unsafe { hearth_core_free(handle) };
}
