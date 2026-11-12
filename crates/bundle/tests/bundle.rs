//! Integration tests for the Bundle container (`AC-BND-1..3`).

use std::io::{Cursor, Read, Write};

use hearth_bundle::error::Error;
use hearth_bundle::manifest::DocType;
use hearth_bundle::sign::{HmacSigner, HmacVerifier};
use hearth_bundle::Bundle;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

const KEY_ID: &str = "test";
const KEY: &[u8] = b"unit-test-signing-key";

fn signer() -> HmacSigner {
    HmacSigner::new(KEY_ID, KEY)
}

fn verifier() -> HmacVerifier {
    HmacVerifier::new(KEY_ID, KEY)
}

fn write_to_vec(bundle: &mut Bundle) -> Vec<u8> {
    let mut buf = Vec::new();
    bundle
        .write(Cursor::new(&mut buf), &signer())
        .expect("write");
    buf
}

/// AC-BND-1: create, save, reopen, document content is identical.
#[test]
fn create_save_reopen_is_identical() {
    let content = b"The quick brown fox jumps over the lazy dog.".to_vec();

    let mut bundle = Bundle::new("My Project");
    let id = bundle.add_document(
        "Notes",
        DocType::Writer,
        "application/octet-stream",
        content.clone(),
    );

    let bytes = write_to_vec(&mut bundle);
    let reopened = Bundle::read(Cursor::new(&bytes)).expect("read");

    assert_eq!(reopened.document_bytes(id), Some(content.as_slice()));
    assert_eq!(reopened.manifest.title, "My Project");
    reopened.verify(&verifier()).expect("verify");
}

/// AC-BND-2: a valid signature verifies.
#[test]
fn valid_signature_verifies() {
    let mut bundle = Bundle::new("Signed");
    bundle.add_document("Doc", DocType::Writer, "text/plain", b"hello".to_vec());
    let bytes = write_to_vec(&mut bundle);

    let reopened = Bundle::read(Cursor::new(&bytes)).expect("read");
    assert!(reopened.verify_signatures(&verifier()).is_ok());
}

/// AC-BND-2: tampering with the manifest invalidates the signature.
#[test]
fn manifest_tampering_fails_signature() {
    let mut bundle = Bundle::new("Original");
    bundle.add_document("Doc", DocType::Writer, "text/plain", b"hello".to_vec());
    let bytes = write_to_vec(&mut bundle);

    let mut reopened = Bundle::read(Cursor::new(&bytes)).expect("read");
    // Tamper with a signed field after the fact.
    reopened.manifest.title = "Tampered".to_owned();

    assert!(matches!(
        reopened.verify_signatures(&verifier()),
        Err(Error::Signature(_))
    ));
}

/// AC-BND-2: byte-level tampering of stored content fails the integrity check.
#[test]
fn content_tampering_fails_integrity() {
    let mut bundle = Bundle::new("Original");
    bundle.add_document(
        "Doc",
        DocType::Writer,
        "text/plain",
        b"important bytes".to_vec(),
    );
    let bytes = write_to_vec(&mut bundle);

    let tampered = flip_document_bytes(&bytes);

    // The manifest's recorded hash no longer matches the stored part.
    let result = Bundle::read(Cursor::new(&tampered));
    assert!(
        matches!(result, Err(Error::Integrity { .. })),
        "expected integrity failure"
    );
}

/// AC-BND-3: a Bundle is a portable container, copy it elsewhere and every
/// document, linked data source, and asset opens intact.
#[test]
fn bundle_is_portable() {
    let doc = b"document body".to_vec();
    let data = b"col1,col2\n1,2\n".to_vec();
    let asset = vec![0u8, 1, 2, 3, 4, 5];

    let mut bundle = Bundle::new("Portable");
    let doc_id = bundle.add_document("Doc", DocType::Writer, "text/plain", doc.clone());
    let data_id = bundle.add_data_source("table.csv", "text/csv", data.clone());
    let asset_id = bundle.add_asset("logo.bin", "application/octet-stream", asset.clone());

    // Write to one location, then "copy to another device" and reopen there.
    let dir = tempfile::tempdir().expect("tempdir");
    let original = dir.path().join("project.hearth");
    bundle.write_to_path(&original, &signer()).expect("write");

    let copied = dir.path().join("copied.hearth");
    std::fs::copy(&original, &copied).expect("copy");

    let reopened = Bundle::read_from_path(&copied).expect("read");
    reopened.verify(&verifier()).expect("verify");

    assert_eq!(reopened.document_bytes(doc_id), Some(doc.as_slice()));
    assert_eq!(reopened.manifest.data_sources.len(), 1);
    assert_eq!(reopened.manifest.assets.len(), 1);

    let data_path = &reopened.manifest.data_sources[0].path;
    let asset_path = &reopened.manifest.assets[0].path;
    assert_eq!(reopened.part_bytes(data_path), Some(data.as_slice()));
    assert_eq!(reopened.part_bytes(asset_path), Some(asset.as_slice()));
    assert_eq!(reopened.manifest.data_sources[0].id, data_id);
    assert_eq!(reopened.manifest.assets[0].id, asset_id);
}

/// Rebuild the container with every `documents/*` part's bytes bit-flipped,
/// leaving the manifest untouched, i.e. byte-level content tampering.
fn flip_document_bytes(zip_bytes: &[u8]) -> Vec<u8> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes)).expect("open");
    let mut out = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).expect("entry");
        let name = file.name().expect("entry name").into_owned();
        let mut data = Vec::new();
        file.read_to_end(&mut data).expect("read entry");
        if name.starts_with("documents/") {
            for byte in &mut data {
                *byte ^= 0xFF;
            }
        }
        out.start_file(name, opts).expect("start");
        out.write_all(&data).expect("write");
    }
    out.finish().expect("finish").into_inner()
}
