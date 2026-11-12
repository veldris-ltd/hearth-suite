//! Primary end-to-end journey (`AC-QA-4`): create → edit → Ember → Seal →
//! reopen, entirely offline.
//!
//! This drives the real `HearthCore`, the exact shared core every packaged
//! client (desktop, mobile) runs behind its transport, with the in-memory
//! inference backend. No networking crate is linked or reachable, so the whole
//! journey necessarily completes without a network.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use hearth_ember_bridge::testing::MockBackend;
use hearth_ember_bridge::InferenceBackend;
use hearth_ffi::dto::{
    CreateBundleRequest, DocTypeDto, EffortDto, EmberRequest, SaveDocumentRequest, SealRequest,
    TaskDto,
};
use hearth_ffi::HearthCore;

const LETTER: &[u8] = b"Dear friend,\n\nThank you for the warm welcome.\n";

#[test]
fn create_edit_ember_seal_reopen_offline() {
    let dir = tempfile::tempdir().expect("temp dir");
    let backend: Box<dyn InferenceBackend> =
        Box::new(MockBackend::canned("A warmer opening paragraph."));
    let core = HearthCore::open(dir.path(), &[3u8; 32], backend).expect("open core offline");

    // 1. create a Bundle.
    let bundle = core
        .create_bundle(&CreateBundleRequest {
            title: "Welcome letter".to_owned(),
        })
        .expect("create bundle");
    assert_eq!(core.list_bundles().expect("list").len(), 1);

    // 2. edit: save a Writer document into the Bundle (encrypted to the vault).
    let doc = core
        .save_document(&SaveDocumentRequest {
            bundle_id: bundle.id.clone(),
            doc_type: DocTypeDto::Writer,
            content_base64: B64.encode(LETTER),
            title: Some("Welcome".to_owned()),
        })
        .expect("save document");

    // 3. Ember: an on-device assist. The response is labelled device-local.
    let ember = core
        .run_ember(&EmberRequest {
            task: TaskDto::Rewrite,
            document: String::from_utf8_lossy(LETTER).into_owned(),
            request: "Make the opening warmer.".to_owned(),
            effort: EffortDto::Balanced,
        })
        .expect("run ember");
    assert!(ember.device_local, "Ember must run on-device (AC-QA-4)");

    // 4. Seal: encrypt the letter to a recipient (here, the user themselves).
    let sealed = core
        .seal(&SealRequest {
            content_base64: B64.encode(LETTER),
            recipient_public_keys: vec![core.identity_public()],
        })
        .expect("seal");
    assert!(
        core.verify(&sealed, &core.identity_public())
            .expect("verify"),
        "the sealed manifest signature must verify"
    );

    // 5. reopen offline: unseal the sealed copy and reopen the saved document;
    // both recover the original bytes with no network.
    let unsealed = core.unseal(&sealed).expect("unseal");
    assert_eq!(B64.decode(unsealed.content_base64).expect("b64"), LETTER);

    let reopened = core.open_document(&doc.id).expect("reopen document");
    assert_eq!(B64.decode(reopened.content_base64).expect("b64"), LETTER);
}
