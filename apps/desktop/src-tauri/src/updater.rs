//! Verified auto-update (diagram 06d, AC-DESK-3 / P2-R2).
//!
//! The flow: fetch signed TUF `targets` metadata from the release channel,
//! **verify its ML-DSA signature against the pinned roots, reject rollbacks, and
//! match the downloaded artifact's hash + length before anything is installed**.
//! The cryptographic substance lives in the `hearth-release` crate (unit-tested
//! there); this module is the Tauri orchestration plus the pinned-root and
//! channel configuration.
//!
//! Two independent layers must agree before an update is applied: our TUF /
//! ML-DSA metadata check (this module) and the platform updater's own signed
//! download + OS-correct install (`tauri-plugin-updater`). The verified artifact
//! bytes are matched against the TUF-signed hash before `install`.
//!
//! All trust material is provisioned at build time (`option_env!`) so it is
//! baked into the binary, never read from the runtime environment an attacker
//! could influence. An unconfigured build fails closed: every update is rejected
//! and offline use is never blocked.

use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use hearth_release::{artifact_name_from_url, ReleaseMetadata, TrustedRoots};
use hearth_seal::ReleaseVerifyingKey;

/// The id of the pinned release-signing root key. Must match the signer's
/// `--keyid` (`hearth-tuf-sign`) and the release-service's `HEARTH_ROOT_KEY_ID`.
const ROOT_KEY_ID: &str = match option_env!("HEARTH_ROOT_KEY_ID") {
    Some(id) => id,
    None => "hearth-release",
};

/// The pinned root verifying key (ML-DSA-65), base64, baked at build time. An
/// empty/placeholder value yields an empty root set, so **every** update is
/// rejected as untrusted: the client fails closed and can never be tricked into
/// installing an unsigned build.
const ROOT_PUBKEY_B64: &str = match option_env!("HEARTH_ROOT_PUBKEY_B64") {
    Some(key) => key,
    None => "",
};

/// The TUF release channel base URL, baked at build time. Empty -> update checks
/// are a non-blocking no-op (offline-safe; the app still runs fully).
const CHANNEL_BASE_URL: &str = match option_env!("HEARTH_UPDATE_URL") {
    Some(url) => url,
    None => "",
};

/// Which channel this build follows (`beta` or `stable`).
const CHANNEL: &str = match option_env!("HEARTH_UPDATE_CHANNEL") {
    Some(channel) => channel,
    None => "stable",
};

/// The result of an update check, mirrored by the TypeScript `UpdateStatus`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateStatus {
    /// No newer verified update is available.
    UpToDate,
    /// A newer, signature-and-hash-verifiable update exists.
    Available {
        /// The offered metadata version.
        version: String,
    },
    /// The check failed (offline, unreachable, or verification error).
    Error {
        /// A plain-language explanation.
        message: String,
    },
}

/// Build the pinned root set baked into this binary.
fn pinned_roots() -> TrustedRoots {
    let mut roots = TrustedRoots::new();
    if let Ok(bytes) = B64.decode(ROOT_PUBKEY_B64) {
        if let Ok(key) = ReleaseVerifyingKey::from_bytes(&bytes) {
            roots.insert(ROOT_KEY_ID, key);
        }
    }
    roots
}

/// The URL of this channel's signed `targets.json`, or `None` when no channel
/// is configured (the update feature is then a non-blocking no-op).
fn metadata_url() -> Option<String> {
    build_metadata_url(CHANNEL_BASE_URL, CHANNEL)
}

/// Pure URL builder (testable without the build-time env).
fn build_metadata_url(base: &str, channel: &str) -> Option<String> {
    if base.is_empty() {
        return None;
    }
    Some(format!(
        "{}/{channel}/targets.json",
        base.trim_end_matches('/')
    ))
}

/// The metadata version this build trusts as its floor (rollback protection).
///
/// The greater of the version baked at build time and the last version we
/// recorded installing, so a downgrade is always refused even across restarts.
fn current_version() -> u32 {
    let baked = option_env!("HEARTH_BUILD_VERSION")
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let persisted = version_file()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    resolve_version(baked, persisted)
}

/// Pure rollback floor: the newer of the baked and persisted versions.
fn resolve_version(baked: u32, persisted: u32) -> u32 {
    baked.max(persisted)
}

/// Where the last-installed metadata version is recorded (per-user data dir).
fn version_file() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("Hearth").join("installed-version"))
}

/// Record the metadata version of a freshly installed update.
fn record_installed_version(version: u32) {
    if let Some(path) = version_file() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, version.to_string());
    }
}

/// The verification gate: parse the metadata, verify its signature against
/// `roots`, reject rollbacks, and report whether a newer verified version
/// exists. Pure and deterministic; the network/install glue calls into it.
fn evaluate(metadata_json: &str, current: u32, roots: &TrustedRoots) -> UpdateStatus {
    let metadata = match ReleaseMetadata::from_json(metadata_json) {
        Ok(m) => m,
        Err(e) => {
            return UpdateStatus::Error {
                message: e.to_string(),
            }
        }
    };
    let verified = match metadata.verify(roots) {
        Ok(v) => v,
        Err(e) => {
            return UpdateStatus::Error {
                message: e.to_string(),
            }
        }
    };
    match verified.ensure_newer_than(current) {
        Ok(()) => UpdateStatus::Available {
            version: verified.version().to_string(),
        },
        Err(_) => UpdateStatus::UpToDate,
    }
}

/// Fetch the signed targets metadata from the release channel over HTTPS.
///
/// Returns "release channel not configured" when no channel URL is baked in,
/// which surfaces as a non-blocking no-op update check (offline-safe).
async fn fetch_release_metadata() -> Result<String, String> {
    let url = metadata_url().ok_or_else(|| "release channel not configured".to_owned())?;
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "release channel returned HTTP {}",
            response.status()
        ));
    }
    response.text().await.map_err(|e| e.to_string())
}

/// Check for a verified update (invoked from the webview on startup).
#[tauri::command]
pub async fn check_for_update() -> UpdateStatus {
    match fetch_release_metadata().await {
        Ok(json) => evaluate(&json, current_version(), &pinned_roots()),
        Err(message) => UpdateStatus::Error { message },
    }
}

/// Download and install a verified update, then relaunch.
///
/// In order: (1) re-fetch + verify the signed TUF metadata against the pinned
/// roots and reject rollbacks; (2) ask the platform updater for the matching
/// release and download its bytes (the plugin checks its own signature); (3)
/// match those bytes against the TUF-signed hash + length, the mandatory gate;
/// (4) install (OS-correct) and record the new version; (5) relaunch. Nothing is
/// written to disk before step 3 passes.
///
/// # Errors
/// Returns a plain-language message if the channel is unconfigured/unreachable,
/// verification fails, no matching artifact is offered, or the install fails.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    // 1. Our independent trust gate: fetch + verify the TUF metadata.
    let json = fetch_release_metadata().await?;
    let metadata = ReleaseMetadata::from_json(&json).map_err(|e| e.to_string())?;
    let verified = metadata
        .verify(&pinned_roots())
        .map_err(|e| e.to_string())?;
    verified
        .ensure_newer_than(current_version())
        .map_err(|e| e.to_string())?;

    // 2. Ask the platform updater for the matching release.
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update offered by the channel".to_owned())?;

    // 3. Download the artifact (the plugin verifies its own signature), then
    //    require the bytes to match the TUF-signed target of the same name.
    //    The name comes from the download URL, never from guessing by
    //    extension: Windows publishes both an .msi and a -setup.exe (AC-WIN-4).
    let target = artifact_name_from_url(update.download_url.as_str())
        .ok_or_else(|| "the update URL names no installer file".to_owned())?;
    let bytes = update
        .download(|_downloaded, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    verified
        .verify_artifact(&target, &bytes)
        .map_err(|e| e.to_string())?;

    // 4. Apply (OS-correct) and record the new installed version for rollback
    //    protection on the next launch.
    update.install(&bytes).map_err(|e| e.to_string())?;
    record_installed_version(verified.version());

    // 5. Relaunch into the freshly installed version (diverges).
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use hearth_release::{sign_targets, SignedTargets};
    use hearth_seal::ReleaseSigningKey;

    #[test]
    fn unsigned_metadata_is_untrusted_by_default_roots() {
        // The placeholder build pins no usable root -> every update is rejected.
        let json = r#"{"signed":{"_type":"targets","spec_version":"1.0.0","version":9,
            "targets":{}},"signatures":[]}"#;
        assert!(matches!(
            evaluate(json, 0, &pinned_roots()),
            UpdateStatus::Error { .. }
        ));
    }

    #[test]
    fn signed_newer_metadata_is_available() {
        let root = ReleaseSigningKey::from_seed(&[1u8; 32]).unwrap();
        let signed = SignedTargets::new(5).with_target("Hearth.AppImage", b"bytes");
        let metadata = sign_targets(signed, ROOT_KEY_ID, &root).unwrap();
        let roots = TrustedRoots::new().with_key(ROOT_KEY_ID, root.verifying_key());
        match evaluate(&metadata.to_json().unwrap(), 4, &roots) {
            UpdateStatus::Available { version } => assert_eq!(version, "5"),
            other => panic!("expected Available, got {other:?}"),
        }
        // Same version -> not newer -> up to date.
        assert!(matches!(
            evaluate(&metadata.to_json().unwrap(), 5, &roots),
            UpdateStatus::UpToDate
        ));
    }

    #[test]
    fn metadata_url_is_none_without_a_channel() {
        assert_eq!(build_metadata_url("", "beta"), None);
        assert_eq!(
            build_metadata_url("https://r.example/", "beta").as_deref(),
            Some("https://r.example/beta/targets.json")
        );
        assert_eq!(
            build_metadata_url("https://r.example", "stable").as_deref(),
            Some("https://r.example/stable/targets.json")
        );
    }

    #[test]
    fn rollback_floor_is_the_newer_version() {
        assert_eq!(resolve_version(0, 0), 0);
        assert_eq!(resolve_version(7, 3), 7); // baked build floor wins
        assert_eq!(resolve_version(3, 9), 9); // a later install wins
    }
}
