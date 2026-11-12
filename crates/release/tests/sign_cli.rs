//! End-to-end test for the `hearth-tuf-sign` CLI (P2-R1).
//!
//! Proves the CI signing tool produces metadata that the release-service's
//! pinned-root verification accepts, and that a different (untrusted) root is
//! rejected exactly as the service's `publish` would reject it with 422.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hearth_release::{Error, ReleaseMetadata, TrustedRoots};
use hearth_seal::{ReleaseSigningKey, ReleaseVerifyingKey};

const BIN: &str = env!("CARGO_BIN_EXE_hearth-tuf-sign");
const KEYID: &str = "hearth-release";

fn seed() -> [u8; 32] {
    [7u8; 32]
}

fn role_key() -> ReleaseSigningKey {
    ReleaseSigningKey::from_seed(&seed()).unwrap()
}

/// A unique scratch directory for this test process.
fn workdir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hearth-tuf-sign-{}-{tag}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn signs_metadata_that_pinned_roots_accept() {
    let dir = workdir("sign");
    // Two real artifacts, plus sidecars that must NOT become targets.
    fs::write(dir.join("Hearth_1.0.0_amd64.AppImage"), b"appimage bytes").unwrap();
    fs::write(dir.join("Hearth_1.0.0_x64.msi"), b"windows installer bytes").unwrap();
    fs::write(dir.join("Hearth_1.0.0_amd64.AppImage.sig"), b"cosign sig").unwrap();
    fs::write(dir.join("sbom.json"), b"{}").unwrap();

    let out = dir.join("targets.json");
    let status = Command::new(BIN)
        .args(["sign", "--dir"])
        .arg(&dir)
        .args(["--version", "5", "--keyid", KEYID, "--out"])
        .arg(&out)
        .env("HEARTH_RELEASE_ROLE_SEED", B64.encode(seed()))
        .status()
        .unwrap();
    assert!(status.success(), "signer should exit 0");

    let json = fs::read_to_string(&out).unwrap();
    let metadata = ReleaseMetadata::from_json(&json).unwrap();
    assert_eq!(metadata.signatures.len(), 1, "metadata must be signed");
    assert!(
        !metadata.signatures[0].sig.is_empty(),
        "signature must be non-empty"
    );

    // Mirror release-service `pinned_roots()`: rebuild the verifying key from its
    // serialised bytes (as the operator provisions it via HEARTH_ROOT_PUBKEY_B64).
    let vk_bytes = role_key().verifying_key().to_bytes();
    let pinned = ReleaseVerifyingKey::from_bytes(&vk_bytes).unwrap();
    let roots = TrustedRoots::new().with_key(KEYID, pinned);

    let verified = metadata
        .verify(&roots)
        .expect("publish would accept this (CREATED)");
    assert_eq!(verified.version(), 5);

    let names: Vec<&str> = verified.target_names().collect();
    assert!(names.contains(&"Hearth_1.0.0_amd64.AppImage"));
    assert!(names.contains(&"Hearth_1.0.0_x64.msi"));
    // The .sig and .json sidecars must NOT have been signed as targets.
    assert!(!names.contains(&"Hearth_1.0.0_amd64.AppImage.sig"));
    assert!(!names.contains(&"sbom.json"));
    assert_eq!(names.len(), 2);

    verified
        .verify_artifact("Hearth_1.0.0_amd64.AppImage", b"appimage bytes")
        .expect("the signed hash matches the real artifact");
    assert!(verified
        .verify_artifact("Hearth_1.0.0_amd64.AppImage", b"tampered")
        .is_err());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn an_untrusted_root_is_rejected_like_a_422() {
    let dir = workdir("untrusted");
    fs::write(dir.join("Hearth.AppImage"), b"bytes").unwrap();
    let out = dir.join("targets.json");
    let status = Command::new(BIN)
        .args(["sign", "--dir"])
        .arg(&dir)
        .args(["--version", "2", "--out"])
        .arg(&out)
        .env("HEARTH_RELEASE_ROLE_SEED", B64.encode(seed()))
        .status()
        .unwrap();
    assert!(status.success());

    let metadata = ReleaseMetadata::from_json(&fs::read_to_string(&out).unwrap()).unwrap();
    // A DIFFERENT key pinned under the same id: the service would return 422.
    let other = ReleaseSigningKey::from_seed(&[9u8; 32])
        .unwrap()
        .verifying_key();
    let roots = TrustedRoots::new().with_key(KEYID, other);
    assert!(matches!(metadata.verify(&roots), Err(Error::Untrusted)));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn pubkey_prints_the_pinnable_verifying_key() {
    let output = Command::new(BIN)
        .arg("pubkey")
        .env("HEARTH_RELEASE_ROLE_SEED", B64.encode(seed()))
        .output()
        .unwrap();
    assert!(output.status.success());
    let printed = String::from_utf8(output.stdout).unwrap();
    let bytes = B64.decode(printed.trim()).unwrap();
    // The printed key parses and matches the role seed's verifying key.
    ReleaseVerifyingKey::from_bytes(&bytes).unwrap();
    assert_eq!(bytes, role_key().verifying_key().to_bytes());
}

#[test]
fn missing_seed_fails_cleanly() {
    let output = Command::new(BIN)
        .arg("pubkey")
        .env_remove("HEARTH_RELEASE_ROLE_SEED")
        .output()
        .unwrap();
    assert!(!output.status.success(), "must fail without a role seed");
}
