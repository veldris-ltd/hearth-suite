//! AC-WIN-4: beta updates verify end to end (P12.2, ADR-HS-010).
//!
//! Replays the client's decision sequence from `apps/desktop/src-tauri/src/updater.rs`
//! against a Windows feed: verify the TUF metadata against the pinned roots,
//! refuse anything not newer than the installed floor, name the target from the
//! download URL, then match the downloaded bytes. The Tauri minisign check sits
//! between the last two steps inside `tauri-plugin-updater` and is not
//! reproduced here.

use hearth_release::{
    artifact_name_from_url, sign_targets, Error, ReleaseMetadata, SignedTargets, TrustedRoots,
};
use hearth_seal::ReleaseSigningKey;

const BETA_KEYID: &str = "hearth-beta";
const MSI: &str = "Hearth Suite_0.1.43_x64_en-US.msi";
const EXE: &str = "Hearth Suite_0.1.43_x64-setup.exe";
const MSI_URL: &str = "https://feed.example/beta/Hearth%20Suite_0.1.43_x64_en-US.msi";
const MSI_BYTES: &[u8] = b"msi installer for build 43";
const EXE_BYTES: &[u8] = b"nsis installer for build 43";

fn beta_key() -> ReleaseSigningKey {
    ReleaseSigningKey::from_seed(&[43u8; 32]).unwrap()
}

/// Roots pinned in a beta client build (the beta TUF key only).
fn beta_roots() -> TrustedRoots {
    TrustedRoots::new().with_key(BETA_KEYID, beta_key().verifying_key())
}

/// The signed feed for build `version`, as ci/tuf/generate-metadata.sh writes it.
fn feed(version: u32) -> ReleaseMetadata {
    let signed = SignedTargets::new(version)
        .with_target(MSI, MSI_BYTES)
        .with_target(EXE, EXE_BYTES);
    sign_targets(signed, BETA_KEYID, &beta_key()).unwrap()
}

/// The client's install decision, in the order `install_update` runs it.
fn install_decision(
    metadata_json: &str,
    installed: u32,
    download_url: &str,
    downloaded: &[u8],
) -> Result<u32, String> {
    let metadata = ReleaseMetadata::from_json(metadata_json).map_err(|e| e.to_string())?;
    let verified = metadata.verify(&beta_roots()).map_err(|e| e.to_string())?;
    verified
        .ensure_newer_than(installed)
        .map_err(|e| e.to_string())?;
    let target = artifact_name_from_url(download_url).ok_or("no file name in URL")?;
    verified
        .verify_artifact(&target, downloaded)
        .map_err(|e| e.to_string())?;
    Ok(verified.version())
}

#[test]
fn ac_win_4_build_n_installs_n_plus_one() {
    let json = feed(43).to_json().unwrap();
    assert_eq!(install_decision(&json, 42, MSI_URL, MSI_BYTES), Ok(43));
}

#[test]
fn ac_win_4_tampered_installer_is_refused() {
    let json = feed(43).to_json().unwrap();
    let err =
        install_decision(&json, 42, MSI_URL, b"msi installer for build 43, patched").unwrap_err();
    assert!(err.contains("hash") || err.contains("length"), "{err}");
}

#[test]
fn ac_win_4_unsigned_metadata_is_refused() {
    let mut metadata = feed(43);
    metadata.signatures.clear();
    let json = metadata.to_json().unwrap();
    assert!(install_decision(&json, 42, MSI_URL, MSI_BYTES).is_err());
}

#[test]
fn ac_win_4_rollback_and_replay_are_refused() {
    let older = feed(41).to_json().unwrap();
    assert!(install_decision(&older, 42, MSI_URL, MSI_BYTES)
        .unwrap_err()
        .contains("rollback"));
    let same = feed(42).to_json().unwrap();
    assert!(install_decision(&same, 42, MSI_URL, MSI_BYTES).is_err());
}

#[test]
fn ac_win_4_metadata_from_another_key_is_refused() {
    // A stable or stolen key under the beta key id must not verify.
    let foreign = ReleaseSigningKey::from_seed(&[9u8; 32]).unwrap();
    let signed = SignedTargets::new(43).with_target(MSI, MSI_BYTES);
    let json = sign_targets(signed, BETA_KEYID, &foreign)
        .unwrap()
        .to_json()
        .unwrap();
    let err = install_decision(&json, 42, MSI_URL, MSI_BYTES).unwrap_err();
    assert_eq!(err, Error::Untrusted.to_string());
}

#[test]
fn ac_win_4_target_is_the_downloaded_file_not_the_first_windows_name() {
    // Sorted target names put the setup.exe before the MSI. Matching by URL name
    // checks the MSI against the MSI entry; the old "first .msi or .exe" rule
    // would have checked it against the setup.exe entry and refused it.
    let verified = feed(43).verify(&beta_roots()).unwrap();
    let first_windows_name = verified
        .target_names()
        .find(|n| {
            // The rule this replaced, verbatim: first name containing a marker.
            let lower = n.to_ascii_lowercase();
            [".msi", ".exe"].iter().any(|m| lower.contains(m))
        })
        .unwrap();
    assert_eq!(first_windows_name, EXE);
    assert!(verified
        .verify_artifact(first_windows_name, MSI_BYTES)
        .is_err());
    let json = feed(43).to_json().unwrap();
    assert_eq!(install_decision(&json, 42, MSI_URL, MSI_BYTES), Ok(43));
}

#[test]
fn ac_win_4_a_url_naming_an_unsigned_file_is_refused() {
    let json = feed(43).to_json().unwrap();
    let err = install_decision(
        &json,
        42,
        "https://feed.example/beta/Hearth%20Suite_0.1.43_x64_en-US.msi.zip",
        MSI_BYTES,
    )
    .unwrap_err();
    assert!(err.contains("unknown release target"), "{err}");
}
